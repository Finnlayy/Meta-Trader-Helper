//+------------------------------------------------------------------+
//| ScalpSnipper_Utils.mqh                                           |
//| Expert Advisor: ScalpSnipper | Version 1.00 | 2026-03-26         |
//| Copyright 2026, FinnP                                            |
//| Beschreibung: Gemeinsame Typen, Runtime-Daten und Helfer.        |
//+------------------------------------------------------------------+
#ifndef __SCALPSNIPPER_UTILS_MQH__
#define __SCALPSNIPPER_UTILS_MQH__
#include "ScalpSnipper_Inputs.mqh"

#define SS_APP_NAME            "ScalpSnipper"
#define SS_APP_VERSION         "1.00"
#define SS_LOG_PREFIX          "[ScalpSnipper]"
#define SS_INVALID_ONNX_HANDLE ((long)INVALID_HANDLE)

enum SSModelSignal
{
   SS_SIGNAL_NONE = 0,
   SS_SIGNAL_BUY  = 1,
   SS_SIGNAL_SELL = -1
};

struct SSRuntimeSettings
{
   long             magicNumber;
   bool             showPanel;
   bool             onlyNewBar;
   int              tradeDirection;
   double           signalThreshold;
   bool             closeOnOpposite;
   int              cooldownSeconds;
   int              lotsMode;
   double           fixedLots;
   double           riskPercent;
   int              stopLossPoints;
   int              takeProfitPoints;
   int              maxSpreadPoints;
   int              slippagePoints;
   bool             logDecisions;
   bool             logVerbose;
   ENUM_TIMEFRAMES  featureTF;
   int              lookbackBars;
   int              featureCount;
   string           modelPath;
   bool             onnxUseCPUOnly;
   int              onnxOutputSize;
   bool             enableTimer;
   int              timerSeconds;
   bool             selfTestOnInit;
};

struct SSPositionInfo
{
   bool               exists;
   ulong              ticket;
   ENUM_POSITION_TYPE type;
   double             volume;
   double             openPrice;
   double             stopLoss;
   double             takeProfit;
};

struct SSPanelData
{
   string statusText;
   string detailText;
   string modelText;
   string signalText;
   double score;
   double balance;
   double equity;
   double drawdownPercent;
   double spreadPoints;
   int    openPositions;
   int    tradesToday;
   double winRate;
};

extern SSRuntimeSettings g_settings;

void SSLoadRuntimeFromInputs()
{
   g_settings.magicNumber      = InpMagicNumber;
   g_settings.showPanel        = InpShowPanel;
   g_settings.onlyNewBar       = InpOnlyNewBar;
   g_settings.tradeDirection   = (int)InpTradeDirection;
   g_settings.signalThreshold  = InpSignalThreshold;
   g_settings.closeOnOpposite  = InpCloseOnOpposite;
   g_settings.cooldownSeconds  = InpCooldownSeconds;
   g_settings.lotsMode         = (int)InpLotsMode;
   g_settings.fixedLots        = InpFixedLots;
   g_settings.riskPercent      = InpRiskPercent;
   g_settings.stopLossPoints   = InpStopLossPoints;
   g_settings.takeProfitPoints = InpTakeProfitPoints;
   g_settings.maxSpreadPoints  = InpMaxSpreadPoints;
   g_settings.slippagePoints   = InpSlippagePoints;
   g_settings.logDecisions     = InpLogDecisions;
   g_settings.logVerbose       = InpLogVerbose;
   g_settings.featureTF        = InpFeatureTF;
   g_settings.lookbackBars     = InpLookbackBars;
   g_settings.featureCount     = InpFeatureCount;
   g_settings.modelPath        = InpModelPath;
   g_settings.onnxUseCPUOnly   = InpOnnxUseCPUOnly;
   g_settings.onnxOutputSize   = InpOnnxOutputSize;
   g_settings.enableTimer      = InpEnableTimer;
   g_settings.timerSeconds     = InpTimerSeconds;
   g_settings.selfTestOnInit   = InpSelfTestOnInit;
}

void SSClearPositionInfo(SSPositionInfo &info)
{
   info.exists     = false;
   info.ticket     = 0;
   info.type       = POSITION_TYPE_BUY;
   info.volume     = 0.0;
   info.openPrice  = 0.0;
   info.stopLoss   = 0.0;
   info.takeProfit = 0.0;
}

string SSTimeframeText(const ENUM_TIMEFRAMES timeframe)
{
   switch(timeframe)
   {
      case PERIOD_M1:  return "M1";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
      case PERIOD_D1:  return "D1";
      default:         return "Custom";
   }
}

string SSSignalText(const SSModelSignal signal)
{
   switch(signal)
   {
      case SS_SIGNAL_BUY:  return "Buy";
      case SS_SIGNAL_SELL: return "Sell";
      default:             return "Neutral";
   }
}

string SSBoolText(const bool value)
{
   return value ? "Ja" : "Nein";
}

string SSDateTimeText(const datetime value)
{
   if(value <= 0)
      return "-";

   return TimeToString(value, TIME_DATE | TIME_SECONDS);
}

double SSCurrentDrawdownPercent()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   if(balance <= 0.0 || equity >= balance)
      return 0.0;

   return ((balance - equity) / balance) * 100.0;
}

int SSVolumeDigits(const double volumeStep)
{
   if(volumeStep >= 1.0)
      return 0;
   if(volumeStep >= 0.1)
      return 1;
   if(volumeStep >= 0.01)
      return 2;
   if(volumeStep >= 0.001)
      return 3;
   return 4;
}

double SSNormalizePrice(const string symbol, const double price)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   return NormalizeDouble(price, digits);
}

bool SSIsAbsolutePath(const string path)
{
   if(StringFind(path, ":\\") >= 0 || StringFind(path, ":/") >= 0)
      return true;
   if(StringFind(path, "\\\\") == 0)
      return true;
   if(StringFind(path, "/home/") == 0 || StringFind(path, "/var/") == 0)
      return true;
   if(StringFind(path, "%APPDATA%") >= 0 || StringFind(path, "%appdata%") >= 0 || StringFind(path, "~/") == 0)
      return true;

   return false;
}

bool SSSelectPositionByMagic(const string symbol, const long magicNumber, SSPositionInfo &info)
{
   SSClearPositionInfo(info);

   int totalPositions = (int)PositionsTotal();
   for(int index = totalPositions - 1; index >= 0; --index)
   {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

      if((long)PositionGetInteger(POSITION_MAGIC) != magicNumber)
         continue;

      info.exists     = true;
      info.ticket     = ticket;
      info.type       = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      info.volume     = PositionGetDouble(POSITION_VOLUME);
      info.openPrice  = PositionGetDouble(POSITION_PRICE_OPEN);
      info.stopLoss   = PositionGetDouble(POSITION_SL);
      info.takeProfit = PositionGetDouble(POSITION_TP);
      return true;
   }

   return false;
}

int SSCountPositionsByMagic(const string symbol, const long magicNumber)
{
   int count = 0;

   int totalPositions = (int)PositionsTotal();
   for(int index = totalPositions - 1; index >= 0; --index)
   {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

      if((long)PositionGetInteger(POSITION_MAGIC) != magicNumber)
         continue;

      count++;
   }

   return count;
}

void SSLogInfo(const string message)
{
   Print(SS_LOG_PREFIX, " ", message);
}

void SSLogWarn(const string message)
{
   Print(SS_LOG_PREFIX, " [WARN] ", message);
}

void SSLogError(const string message)
{
   Print(SS_LOG_PREFIX, " [ERROR] ", message);
}

void SSLogDecision(const string message)
{
   if(g_settings.logDecisions)
      Print(SS_LOG_PREFIX, " [DECISION] ", message);
}

void SSLogDebug(const string message)
{
   if(g_settings.logVerbose)
      Print(SS_LOG_PREFIX, " [DEBUG] ", message);
}

#endif // __SCALPSNIPPER_UTILS_MQH__
