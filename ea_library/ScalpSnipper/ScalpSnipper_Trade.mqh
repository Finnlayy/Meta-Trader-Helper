//+------------------------------------------------------------------+
//| ScalpSnipper_Trade.mqh                                           |
//| Expert Advisor: ScalpSnipper | Version 1.00 | 2026-03-26         |
//| Copyright 2026, FinnP                                            |
//| Beschreibung: ONNX-, Signal- und Handelslogik des EA.           |
//+------------------------------------------------------------------+
#ifndef __SCALPSNIPPER_TRADE_MQH__
#define __SCALPSNIPPER_TRADE_MQH__
#include <Trade/Trade.mqh>
#include "ScalpSnipper_Risk.mqh"
#resource "model.onnx" as uchar SS_EMBEDDED_MODEL[]

class CScalpSnipperEngine
{
private:
   CTrade             m_trade;
   CScalpSnipperRisk  m_risk;
   bool               m_initialized;
   bool               m_busy;
   bool               m_modelReady;
   long               m_onnxHandle;
   datetime           m_lastBarTime;
   datetime           m_cooldownUntil;
   string             m_statusText;
   string             m_detailText;
   SSPositionInfo     m_position;
   int                m_tradesToday;
   int                m_closedTrades;
   int                m_winningTrades;
   string             m_todayStamp;
   SSModelSignal      m_lastSignal;
   double             m_lastScore;

   void PushFeature(float &features[], int &featureIndex, const double value) const
   {
      if(featureIndex < g_settings.featureCount)
      {
         features[featureIndex] = (float)value;
         featureIndex++;
      }
   }

public:
   CScalpSnipperEngine(void)
   {
      m_initialized    = false;
      m_busy           = false;
      m_modelReady     = false;
      m_onnxHandle     = SS_INVALID_ONNX_HANDLE;
      m_lastBarTime    = 0;
      m_cooldownUntil  = 0;
      m_statusText     = "Startet";
      m_detailText     = "Warte auf Initialisierung.";
      m_tradesToday    = 0;
      m_closedTrades   = 0;
      m_winningTrades  = 0;
      m_todayStamp     = "";
      m_lastSignal     = SS_SIGNAL_NONE;
      m_lastScore      = 0.0;
      SSClearPositionInfo(m_position);
   }

   int Init()
   {
      string reason;
      if(!m_risk.ValidateSettings(reason))
      {
         SetStatus("Init fehlgeschlagen", reason);
         SSLogError(reason);
         return INIT_FAILED;
      }

      m_trade.SetExpertMagicNumber(g_settings.magicNumber);
      m_trade.SetDeviationInPoints(g_settings.slippagePoints);

      RefreshDayStamp();
      RefreshPosition();

      if(!InitOnnx(reason))
      {
         SetStatus("Init fehlgeschlagen", reason);
         SSLogError(reason);
         return INIT_FAILED;
      }

      if(g_settings.selfTestOnInit && !RunSelfTest(reason))
      {
         SetStatus("Selbsttest fehlgeschlagen", reason);
         SSLogError(reason);
         ReleaseOnnx();
         return INIT_FAILED;
      }

      m_initialized = true;
      SetStatus("Bereit", "EA gestartet. Warte auf das naechste gueltige Signal.");
      SSLogInfo(StringFormat("%s v%s gestartet. TF=%s, Modell=%s",
                SS_APP_NAME,
                SS_APP_VERSION,
                SSTimeframeText(g_settings.featureTF),
                g_settings.modelPath));
      return INIT_SUCCEEDED;
   }

   void Shutdown(const int reason)
   {
      ReleaseOnnx();
      m_initialized = false;
      SetStatus("Beendet", StringFormat("Expert Advisor wurde mit Grund %d beendet.", reason));
      SSLogInfo(StringFormat("Shutdown Grund=%d", reason));
   }

   void OnTick()
   {
      if(!m_initialized || m_busy)
         return;

      m_busy = true;
      RefreshDayStamp();
      RefreshPosition();

      if(g_settings.onlyNewBar && !HasNewFeatureBar())
      {
         m_busy = false;
         return;
      }

      float features[];
      string reason;
      if(!BuildFeatures(_Symbol, features, reason))
      {
         SetStatus("Warte", reason);
         m_busy = false;
         return;
      }

      float output[];
      if(!RunModel(features, output, reason))
      {
         SetStatus("Fehler", reason);
         m_busy = false;
         return;
      }

      double score = 0.0;
      SSModelSignal signal = MapSignal(output, score);
      m_lastSignal = signal;
      m_lastScore  = score;

      if(m_position.exists)
         ManageOpenPosition(signal);
      else
         ManageFlatState(signal);

      m_busy = false;
   }

   void OnTimer()
   {
      if(!m_initialized)
         return;

      if(g_settings.logVerbose)
         SSLogDebug("Timer-Heartbeat aktiv.");
   }

   void OnTradeTransaction(const MqlTradeTransaction &trans,
                           const MqlTradeRequest &request,
                           const MqlTradeResult &result)
   {
      if(!m_initialized)
         return;

      RefreshDayStamp();

      if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
         return;

      if(trans.deal == 0 || trans.symbol != _Symbol)
         return;

      if(!HistoryDealSelect(trans.deal))
         return;

      if((long)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != g_settings.magicNumber)
         return;

      long entryType = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
      if(entryType == DEAL_ENTRY_IN)
      {
         m_tradesToday++;
         m_detailText = "Position erfolgreich eroeffnet.";
      }
      else if(entryType == DEAL_ENTRY_OUT || entryType == DEAL_ENTRY_OUT_BY)
      {
         double netProfit =
            HistoryDealGetDouble(trans.deal, DEAL_PROFIT) +
            HistoryDealGetDouble(trans.deal, DEAL_COMMISSION) +
            HistoryDealGetDouble(trans.deal, DEAL_SWAP);
         m_closedTrades++;
         if(netProfit > 0.0)
            m_winningTrades++;

         m_detailText = StringFormat("Position geschlossen. Netto %.2f %s.",
                                     netProfit,
                                     AccountInfoString(ACCOUNT_CURRENCY));
      }

      if(g_settings.logVerbose)
      {
         SSLogDebug(StringFormat("TradeTx retcode=%d, requestType=%d",
                                 (int)result.retcode,
                                 (int)request.action));
      }

      RefreshPosition();
   }

   SSPanelData Snapshot() const
   {
      SSPanelData panel;
      panel.statusText      = m_statusText;
      panel.detailText      = m_detailText;
      panel.modelText       = (m_modelReady ? "ONNX: bereit" : "ONNX: nicht bereit");
      panel.signalText      = SSSignalText(m_lastSignal);
      panel.score           = m_lastScore;
      panel.balance         = AccountInfoDouble(ACCOUNT_BALANCE);
      panel.equity          = AccountInfoDouble(ACCOUNT_EQUITY);
      panel.drawdownPercent = SSCurrentDrawdownPercent();
      panel.spreadPoints    = m_risk.CurrentSpreadPoints(_Symbol);
      panel.openPositions   = SSCountPositionsByMagic(_Symbol, g_settings.magicNumber);
      panel.tradesToday     = m_tradesToday;
      panel.winRate         = (m_closedTrades > 0 ? ((double)m_winningTrades / (double)m_closedTrades) * 100.0 : 0.0);
      return panel;
   }

private:
   void SetStatus(const string statusText, const string detailText)
   {
      m_statusText = statusText;
      m_detailText = detailText;
   }

   void RefreshDayStamp()
   {
      string today = TimeToString(TimeCurrent(), TIME_DATE);
      if(today == m_todayStamp)
         return;

      m_todayStamp    = today;
      m_tradesToday   = 0;
      m_closedTrades  = 0;
      m_winningTrades = 0;
   }

   void RefreshPosition()
   {
      SSSelectPositionByMagic(_Symbol, g_settings.magicNumber, m_position);
   }

   bool HasNewFeatureBar()
   {
      datetime barTime = iTime(_Symbol, g_settings.featureTF, 0);
      if(barTime <= 0)
         return false;

      if(m_lastBarTime == 0)
      {
         m_lastBarTime = barTime;
         return true;
      }

      if(barTime == m_lastBarTime)
         return false;

      m_lastBarTime = barTime;
      return true;
   }

   bool InitOnnx(string &reason)
   {
      ReleaseOnnx();

      uint flags = ONNX_DEFAULT;
      if(g_settings.onnxUseCPUOnly)
         flags |= ONNX_USE_CPU_ONLY;

      if(ArraySize(SS_EMBEDDED_MODEL) > 0)
         m_onnxHandle = OnnxCreateFromBuffer(SS_EMBEDDED_MODEL, flags);

      if(m_onnxHandle == SS_INVALID_ONNX_HANDLE && StringLen(g_settings.modelPath) > 0)
         m_onnxHandle = OnnxCreate(g_settings.modelPath, flags);

      if(m_onnxHandle == SS_INVALID_ONNX_HANDLE)
      {
         int errorCode = GetLastError();
         reason = StringFormat("ONNX-Modell konnte nicht geladen werden (Error %d).", errorCode);
         return false;
      }

      long inputShape[];
      ArrayResize(inputShape, 2);
      inputShape[0] = 1;
      inputShape[1] = g_settings.featureCount;

      long outputShape[];
      ArrayResize(outputShape, 2);
      outputShape[0] = 1;
      outputShape[1] = g_settings.onnxOutputSize;

      if(!OnnxSetInputShape(m_onnxHandle, 0, inputShape))
      {
         int errorCode = GetLastError();
         reason = StringFormat("OnnxSetInputShape fehlgeschlagen (Error %d).", errorCode);
         ReleaseOnnx();
         return false;
      }

      if(!OnnxSetOutputShape(m_onnxHandle, 0, outputShape))
      {
         int errorCode = GetLastError();
         reason = StringFormat("OnnxSetOutputShape fehlgeschlagen (Error %d).", errorCode);
         ReleaseOnnx();
         return false;
      }

      m_modelReady = true;
      reason = "";
      return true;
   }

   void ReleaseOnnx()
   {
      if(m_onnxHandle != SS_INVALID_ONNX_HANDLE)
      {
         OnnxRelease(m_onnxHandle);
         m_onnxHandle = SS_INVALID_ONNX_HANDLE;
      }

      m_modelReady = false;
   }

   bool RunSelfTest(string &reason)
   {
      float features[];
      float output[];

      if(!BuildFeatures(_Symbol, features, reason))
         return false;

      if(!RunModel(features, output, reason))
         return false;

      reason = StringFormat("Selbsttest erfolgreich. Erster Output-Wert %.4f.", (ArraySize(output) > 0 ? (double)output[0] : 0.0));
      SSLogInfo(reason);
      return true;
   }

   bool BuildFeatures(const string symbol, float &features[], string &reason)
   {
      MqlRates rates[];
      ArraySetAsSeries(rates, true);

      int barsToCopy = MathMax(g_settings.lookbackBars, 20);
      int copiedBars = CopyRates(symbol, g_settings.featureTF, 0, barsToCopy, rates);
      if(copiedBars < 10)
      {
         reason = "Zu wenige Historien-Daten fuer die Feature-Berechnung.";
         return false;
      }

      double pointSize = SymbolInfoDouble(symbol, SYMBOL_POINT);
      if(pointSize <= 0.0)
      {
         reason = "Die Point-Groesse des Symbols ist ungueltig.";
         return false;
      }

      ArrayResize(features, g_settings.featureCount);
      ArrayInitialize(features, 0.0f);

      int featureIndex = 0;

      for(int bar = 1; bar <= 8 && bar < copiedBars; ++bar)
      {
         double prevClose = rates[bar].close;
         double currClose = rates[bar - 1].close;
         double closeDeltaPoints = (currClose - prevClose) / pointSize;
         PushFeature(features, featureIndex, closeDeltaPoints);
      }

      for(int bar = 0; bar < 4 && bar < copiedBars; ++bar)
      {
         double rangePoints = (rates[bar].high - rates[bar].low) / pointSize;
         PushFeature(features, featureIndex, rangePoints);
      }

      for(int bar = 0; bar < 4 && bar < copiedBars; ++bar)
      {
         double bodyPoints = (rates[bar].close - rates[bar].open) / pointSize;
         PushFeature(features, featureIndex, bodyPoints);
      }

      double spreadPoints = m_risk.CurrentSpreadPoints(symbol);
      double tickVolumeRatio = (double)rates[0].tick_volume / MathMax((double)rates[1].tick_volume, 1.0);
      PushFeature(features, featureIndex, spreadPoints);
      PushFeature(features, featureIndex, tickVolumeRatio);

      reason = "";
      return true;
   }

   bool RunModel(float &features[], float &output[], string &reason)
   {
      if(!m_modelReady)
      {
         reason = "Das ONNX-Modell ist nicht bereit.";
         return false;
      }

      if(ArraySize(features) != g_settings.featureCount)
      {
         reason = "Die Feature-Anzahl passt nicht zum ONNX-Eingang.";
         return false;
      }

      ArrayResize(output, g_settings.onnxOutputSize);
      ArrayInitialize(output, 0.0f);
      ulong runFlags = ONNX_DATA_TYPE_FLOAT;

      if(!OnnxRun(m_onnxHandle, runFlags, features, output))
      {
         int errorCode = GetLastError();
         reason = StringFormat("OnnxRun fehlgeschlagen (Error %d).", errorCode);
         SSLogError(reason);
         return false;
      }

      reason = "";
      return true;
   }

   SSModelSignal MapSignal(const float &output[], double &score) const
   {
      score = 0.0;
      if(ArraySize(output) <= 0)
         return SS_SIGNAL_NONE;

      score = (double)output[0];
      if(score > g_settings.signalThreshold)
      {
         if(g_settings.tradeDirection == SS_DIRECTION_SHORT_ONLY)
            return SS_SIGNAL_NONE;
         return SS_SIGNAL_BUY;
      }

      if(score < -g_settings.signalThreshold)
      {
         if(g_settings.tradeDirection == SS_DIRECTION_LONG_ONLY)
            return SS_SIGNAL_NONE;
         return SS_SIGNAL_SELL;
      }

      return SS_SIGNAL_NONE;
   }

   bool CooldownActive() const
   {
      return (m_cooldownUntil > 0 && TimeCurrent() < m_cooldownUntil);
   }

   void ManageFlatState(const SSModelSignal signal)
   {
      if(CooldownActive())
      {
         SetStatus("Cooldown", "Neue Einstiege sind bis nach der Cooldown-Zeit gesperrt.");
         return;
      }

      if(signal == SS_SIGNAL_NONE)
      {
         SetStatus("Bereit", "Kein Signal ueber dem Schwellwert.");
         return;
      }

      string reason;
      if(!m_risk.CanTradeNow(_Symbol, true, reason))
      {
         SetStatus("Warte", reason);
         return;
      }

      if(signal == SS_SIGNAL_BUY)
      {
         if(OpenPosition(POSITION_TYPE_BUY, reason))
            SetStatus("Entry aktiv", "Buy-Position wurde angefordert.");
         else
            SetStatus("Entry blockiert", reason);
      }
      else if(signal == SS_SIGNAL_SELL)
      {
         if(OpenPosition(POSITION_TYPE_SELL, reason))
            SetStatus("Entry aktiv", "Sell-Position wurde angefordert.");
         else
            SetStatus("Entry blockiert", reason);
      }
   }

   void ManageOpenPosition(const SSModelSignal signal)
   {
      if(!m_position.exists)
      {
         SetStatus("Bereit", "Keine offene Position gefunden.");
         return;
      }

      SSModelSignal currentDirection = (m_position.type == POSITION_TYPE_BUY ? SS_SIGNAL_BUY : SS_SIGNAL_SELL);
      if(signal == SS_SIGNAL_NONE)
      {
         SetStatus("Position offen", "Position wird gehalten. Kein Gegensignal vorhanden.");
         return;
      }

      if(signal == currentDirection)
      {
         SetStatus("Position offen", "Das aktuelle Signal bestaetigt die laufende Position.");
         return;
      }

      if(!g_settings.closeOnOpposite)
      {
         SetStatus("Position offen", "Gegensignal erkannt, automatischer Exit ist deaktiviert.");
         return;
      }

      string reason;
      if(!m_risk.CanTradeNow(_Symbol, false, reason))
      {
         SetStatus("Exit blockiert", reason);
         return;
      }

      if(ClosePosition(reason))
         SetStatus("Exit aktiv", "Position wegen Gegensignal geschlossen.");
      else
         SetStatus("Exit fehlgeschlagen", reason);
   }

   bool OpenPosition(const ENUM_POSITION_TYPE direction, string &reason)
   {
      if(m_position.exists)
      {
         reason = "Es existiert bereits eine Position mit dieser Magic Number.";
         return false;
      }

      double volume = m_risk.DetermineVolume(_Symbol, reason);
      if(volume <= 0.0)
         return false;

      double pointSize = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      double askPrice  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double bidPrice  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(pointSize <= 0.0 || askPrice <= 0.0 || bidPrice <= 0.0)
      {
         reason = "Marktdaten fuer Bid/Ask oder Point sind ungueltig.";
         return false;
      }

      double stopLoss   = 0.0;
      double takeProfit = 0.0;
      if(direction == POSITION_TYPE_BUY)
      {
         stopLoss = SSNormalizePrice(_Symbol, askPrice - (g_settings.stopLossPoints * pointSize));
         if(g_settings.takeProfitPoints > 0)
            takeProfit = SSNormalizePrice(_Symbol, askPrice + (g_settings.takeProfitPoints * pointSize));
      }
      else
      {
         stopLoss = SSNormalizePrice(_Symbol, bidPrice + (g_settings.stopLossPoints * pointSize));
         if(g_settings.takeProfitPoints > 0)
            takeProfit = SSNormalizePrice(_Symbol, bidPrice - (g_settings.takeProfitPoints * pointSize));
      }

      ResetLastError();
      bool success = false;
      if(direction == POSITION_TYPE_BUY)
         success = m_trade.Buy(volume, _Symbol, 0.0, stopLoss, takeProfit, SS_APP_NAME);
      else
         success = m_trade.Sell(volume, _Symbol, 0.0, stopLoss, takeProfit, SS_APP_NAME);

      if(!success)
      {
         int errorCode = GetLastError();
         reason = StringFormat("Order fehlgeschlagen. Retcode=%u, Meldung=%s, Error=%d",
                               m_trade.ResultRetcode(),
                               m_trade.ResultRetcodeDescription(),
                               errorCode);
         SSLogError(reason);
         return false;
      }

      reason = StringFormat("%s %.2f Lot, SL=%d, TP=%d",
                            (direction == POSITION_TYPE_BUY ? "Buy" : "Sell"),
                            volume,
                            g_settings.stopLossPoints,
                            g_settings.takeProfitPoints);
      SSLogDecision(reason);
      return true;
   }

   bool ClosePosition(string &reason)
   {
      if(!m_position.exists)
      {
         reason = "Es gibt keine offene Position zum Schliessen.";
         return false;
      }

      ResetLastError();
      bool success = m_trade.PositionClose(m_position.ticket);
      if(!success)
      {
         int errorCode = GetLastError();
         reason = StringFormat("Positionsschluss fehlgeschlagen. Retcode=%u, Meldung=%s, Error=%d",
                               m_trade.ResultRetcode(),
                               m_trade.ResultRetcodeDescription(),
                               errorCode);
         SSLogError(reason);
         return false;
      }

      m_cooldownUntil = TimeCurrent() + g_settings.cooldownSeconds;
      reason = "Position wurde erfolgreich geschlossen.";
      SSLogDecision(reason);
      return true;
   }
};

#endif // __SCALPSNIPPER_TRADE_MQH__
