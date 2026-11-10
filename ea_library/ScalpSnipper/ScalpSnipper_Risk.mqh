//+------------------------------------------------------------------+
//| ScalpSnipper_Risk.mqh                                            |
//| Expert Advisor: ScalpSnipper | Version 1.00 | 2026-03-26         |
//| Copyright 2026, FinnP                                            |
//| Beschreibung: Validierung, Spread-Filter und Positionsgroesse.   |
//+------------------------------------------------------------------+
#ifndef __SCALPSNIPPER_RISK_MQH__
#define __SCALPSNIPPER_RISK_MQH__
#include "ScalpSnipper_Utils.mqh"

class CScalpSnipperRisk
{
public:
   bool ValidateSettings(string &reason)
   {
      if(g_settings.magicNumber <= 0)
      {
         reason = "Die Magic Number muss groesser als 0 sein.";
         return false;
      }

      if(g_settings.signalThreshold <= 0.0)
      {
         reason = "Der Signal-Schwellwert muss groesser als 0 sein.";
         return false;
      }

      if(g_settings.cooldownSeconds < 0)
      {
         reason = "Die Cooldown-Zeit darf nicht negativ sein.";
         return false;
      }

      if(g_settings.featureCount <= 0)
      {
         reason = "Die Anzahl der Features muss groesser als 0 sein.";
         return false;
      }

      if(g_settings.lookbackBars < 20)
      {
         reason = "Es werden mindestens 20 Lookback-Bars benoetigt.";
         return false;
      }

      if(g_settings.stopLossPoints <= 0)
      {
         reason = "Der Stop Loss muss groesser als 0 Punkte sein.";
         return false;
      }

      if(g_settings.takeProfitPoints < 0)
      {
         reason = "Der Take Profit darf nicht negativ sein.";
         return false;
      }

      if(g_settings.maxSpreadPoints <= 0)
      {
         reason = "Der maximale Spread muss groesser als 0 Punkte sein.";
         return false;
      }

      if(g_settings.slippagePoints < 0)
      {
         reason = "Slippage darf nicht negativ sein.";
         return false;
      }

      if(g_settings.lotsMode == SS_LOTS_FIXED && g_settings.fixedLots <= 0.0)
      {
         reason = "Die feste Lot-Groesse muss groesser als 0 sein.";
         return false;
      }

      if(g_settings.lotsMode == SS_LOTS_RISK_PERCENT && (g_settings.riskPercent <= 0.0 || g_settings.riskPercent > 10.0))
      {
         reason = "Das Risiko in Prozent muss zwischen 0 und 10 liegen.";
         return false;
      }

      if(g_settings.enableTimer && g_settings.timerSeconds <= 0)
      {
         reason = "Das Timer-Intervall muss groesser als 0 Sekunden sein.";
         return false;
      }

      if(StringLen(g_settings.modelPath) > 0 && SSIsAbsolutePath(g_settings.modelPath))
      {
         reason = "Der Modellpfad muss relativ sein.";
         return false;
      }

      if(g_settings.onnxOutputSize <= 0)
      {
         reason = "Die ONNX-Output-Groesse muss groesser als 0 sein.";
         return false;
      }

      reason = "";
      return true;
   }

   double CurrentSpreadPoints(const string symbol) const
   {
      return (double)SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   }

   bool CanTradeNow(const string symbol, const bool forEntry, string &reason) const
   {
      if(!TerminalInfoInteger(TERMINAL_CONNECTED))
      {
         reason = "Das Terminal ist nicht verbunden.";
         return false;
      }

      if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
      {
         reason = "Automatischer Handel ist fuer diesen Expert Advisor deaktiviert.";
         return false;
      }

      if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      {
         reason = "Der Terminal-Handel ist derzeit nicht erlaubt.";
         return false;
      }

      if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
      {
         reason = "Das Konto erlaubt aktuell keinen Handel.";
         return false;
      }

      long tradeMode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
      if(tradeMode == SYMBOL_TRADE_MODE_DISABLED)
      {
         reason = "Das Symbol ist aktuell nicht handelbar.";
         return false;
      }

      if(forEntry)
      {
         double spread = CurrentSpreadPoints(symbol);
         if(spread > (double)g_settings.maxSpreadPoints)
         {
            reason = StringFormat("Spread zu hoch: %.1f Punkte > %d Punkte.", spread, g_settings.maxSpreadPoints);
            return false;
         }
      }

      reason = "";
      return true;
   }

   double DetermineVolume(const string symbol, string &reason) const
   {
      if(g_settings.lotsMode == SS_LOTS_FIXED)
         return NormalizeVolume(symbol, g_settings.fixedLots, reason);

      return CalculateRiskVolume(symbol, reason);
   }

private:
   double NormalizeVolume(const string symbol, const double requestedVolume, string &reason) const
   {
      double minVolume  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
      double maxVolume  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
      double stepVolume = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

      if(minVolume <= 0.0 || maxVolume <= 0.0 || stepVolume <= 0.0)
      {
         reason = "Das Symbol liefert keine gueltigen Volumen-Grenzen.";
         return 0.0;
      }

      double clamped = MathMax(minVolume, MathMin(maxVolume, requestedVolume));
      double normalized = MathFloor(clamped / stepVolume) * stepVolume;
      if(normalized < minVolume)
         normalized = minVolume;

      int digits = SSVolumeDigits(stepVolume);
      reason = "";
      return NormalizeDouble(normalized, digits);
   }

   double CalculateRiskVolume(const string symbol, string &reason) const
   {
      double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
      double pointSize = SymbolInfoDouble(symbol, SYMBOL_POINT);
      if(tickSize <= 0.0 || tickValue <= 0.0 || pointSize <= 0.0)
      {
         reason = "Tick-Wert oder Point-Groesse des Symbols ist ungueltig.";
         return 0.0;
      }

      double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * (g_settings.riskPercent / 100.0);
      if(riskMoney <= 0.0)
      {
         reason = "Das Kontobalance-Risiko konnte nicht berechnet werden.";
         return 0.0;
      }

      double pointValuePerLot = tickValue * (pointSize / tickSize);
      if(pointValuePerLot <= 0.0)
      {
         reason = "Der Point-Wert pro Lot ist ungueltig.";
         return 0.0;
      }

      double rawVolume = riskMoney / (g_settings.stopLossPoints * pointValuePerLot);
      return NormalizeVolume(symbol, rawVolume, reason);
   }
};

#endif // __SCALPSNIPPER_RISK_MQH__
