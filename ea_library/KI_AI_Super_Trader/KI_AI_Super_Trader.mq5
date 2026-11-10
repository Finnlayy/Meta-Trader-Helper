#property strict
#property script_show_inputs
#property version   "1.2"
#property description "KI_AI_Super_Trader"
#property copyright "Copyright (c) 2026, User"


#include "Core/AI.mqh"
#include "Core/DataAdapter.mqh"
#include "Core/Strategy.mqh"
#include "Core/Execution.mqh"
#include "Core/Risk.mqh"
#include "Core/Exit.mqh"
#include "Core/Memory.mqh"
#include "Core/SessionFilter.mqh"

#include "UI/UI_Main.mqh"

// User-configurable inputs (visible in MT5 parameters dialog)
input RiskMode        InpRiskMode        = RISK_MODERATE;            // initial risk mode
input double          InpFixedLot        = 0.01;                     // fixed lot when using moderate/safe
input double          InpRiskPercent     = 1.0;                      // percent of balance for AI mode
input ENUM_TIMEFRAMES InpRegimeTF        = PERIOD_M5;                // timeframe for regime detection
input bool            InpUseAI           = true;                     // enable AI score blending
input string          InpModelPath       = "Models/XAUUSD-M5-PredModel.onnx"; // path to AI model
input bool            InpSeparateUIChart = true;                     // open UI on a secondary chart
input int             InpMaxPositions    = 1;                        // max simultaneous positions
input double          InpMaxSpreadPoints = 35.0;                     // spread guard in points
input double          InpMaxDailyLossPct = 3.0;                      // daily loss kill switch
input double          InpMaxDrawdownPct  = 10.0;                     // equity drawdown kill switch
input int             InpMaxHoldingBars  = 12;                       // max bars per position
input bool            InpSessionFilter   = true;                     // restrict trading to core sessions

// Runtime copies that can be changed via the UI
double          g_riskPercent = 1.0;
double          g_fixedLot    = 0.01;
ENUM_TIMEFRAMES g_RegimeTF    = PERIOD_M5;
string          g_ModelPath   = "Models/XAUUSD-M5-PredModel.onnx";
bool            g_useAI       = true;
int             g_lastStrategy = STRAT_MEAN;
datetime        g_lastSignalBar = 0;
int             g_maxPositions = 1;
double          g_maxSpreadPoints = 35.0;
double          g_maxDailyLossPct = 3.0;
double          g_maxDrawdownPct = 10.0;
int             g_maxHoldingBars = 12;
bool            g_sessionTradeAllowed = true;
bool            g_killSwitchActive = false;
bool            g_snapshotReady = false;
double          g_currentDailyLossPct = 0.0;
double          g_currentDrawdownPct = 0.0;
double          g_dailyStartEquity = 0.0;
double          g_peakEquity = 0.0;
int             g_lastRiskResetDayKey = 0;
SMarketSnapshot g_marketSnapshot;
CDataAdapter    g_dataAdapter;
CSessionFilter  g_sessionFilter;

// Forward declarations
void UpdateMarket();
bool ShouldEvaluateEntry();
int FindStrategyFromPositionHistory(const long positionId);
int CurrentDayKey();

int OnInit()
{
   g_riskPercent = InpRiskPercent;
   g_fixedLot    = InpFixedLot;
   g_RegimeTF    = InpRegimeTF;
   g_ModelPath   = InpModelPath;
   g_useAI       = InpUseAI;
   g_maxPositions = MathMax(1, InpMaxPositions);
   g_maxSpreadPoints = InpMaxSpreadPoints;
   g_maxDailyLossPct = InpMaxDailyLossPct;
   g_maxDrawdownPct = InpMaxDrawdownPct;
   g_maxHoldingBars = MathMax(1, InpMaxHoldingBars);

   LoadMemory();

   currentRisk = InpRiskMode;
   lotSize     = g_fixedLot;
   ApplyRiskMode();

   string lowerModelPath = g_ModelPath;
   StringToLower(lowerModelPath);
   if(StringFind(lowerModelPath, ".onnx") < 0)
      PrintFormat("[KI_AI_Super_Trader] Warnung: ModelPath '%s' hat keine .onnx-Endung.", g_ModelPath);
   else
      PrintFormat("[KI_AI_Super_Trader] ONNX-Modellpfad gesetzt: %s", g_ModelPath);

   if(!InitUI(InpSeparateUIChart))
      Print("UI initialization failed; running headless");

   g_sessionFilter.Init(7, 17, 13, 22, true, InpSessionFilter);
   g_snapshotReady = g_dataAdapter.Init(_Symbol, g_RegimeTF);
   g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity       = g_dailyStartEquity;
   g_lastRiskResetDayKey = CurrentDayKey();

   return(INIT_SUCCEEDED);
}

void OnTick()
{
   UpdateMarket();
   UpdateAI();

   currentRegime = DetectMarket(g_RegimeTF);
   int strategy  = g_useAI ? GetFinalStrategy() : GetStrategyForRegime(currentRegime);
   g_lastStrategy = strategy;

   ApplyRiskMode();
   if(ShouldEvaluateEntry())
      ExecuteStrategy(strategy);

   ManagePositions();
   UpdateUI();
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal <= 0)
      return;

   if(!HistoryDealSelect(trans.deal))
      return;

   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY)
      return;

   long positionId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   int strategy    = FindStrategyFromPositionHistory(positionId);
   if(strategy < 0)
      strategy = g_lastStrategy;

   double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT) +
                   HistoryDealGetDouble(trans.deal, DEAL_SWAP) +
                   HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);

   RecordStrategyResult(strategy, profit);
}

void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam)
{
   HandleUIEvent(id,lparam,dparam,sparam);
}

void OnDeinit(const int reason)
{
   g_dataAdapter.Deinit();
   RegimeReleaseHandles();
   SaveStats();
   ShutdownUI();
}

// Basic market refresh hook (placeholder for later enhancements)
void UpdateMarket()
{
   int currentDay = CurrentDayKey();
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);

   if(currentDay != g_lastRiskResetDayKey)
   {
      g_lastRiskResetDayKey = currentDay;
      g_dailyStartEquity    = equity;
      g_peakEquity          = equity;
      g_killSwitchActive = false;
   }

   if(g_dailyStartEquity <= 0.0)
      g_dailyStartEquity = equity;
   if(g_peakEquity <= 0.0 || equity > g_peakEquity)
      g_peakEquity = equity;

   static ENUM_TIMEFRAMES s_adapterTf = PERIOD_CURRENT;
   if(s_adapterTf != g_RegimeTF)
   {
      g_dataAdapter.Deinit();
      g_snapshotReady = g_dataAdapter.Init(_Symbol, g_RegimeTF);
      s_adapterTf = g_RegimeTF;
   }

   if(g_snapshotReady)
      g_snapshotReady = g_dataAdapter.BuildSnapshot(g_marketSnapshot);

   g_sessionTradeAllowed = g_sessionFilter.IsTradeAllowed();

   if(g_dailyStartEquity > 0.0)
      g_currentDailyLossPct = MathMax(0.0, ((g_dailyStartEquity - equity) / g_dailyStartEquity) * 100.0);
   if(g_peakEquity > 0.0)
      g_currentDrawdownPct = MathMax(0.0, ((g_peakEquity - equity) / g_peakEquity) * 100.0);

   if(g_snapshotReady)
   {
      double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      if(point <= 0.0)
         point = 0.00001;

      double atrPoints = g_marketSnapshot.atr14 / point;
      if(atrPoints >= 250.0)
         cooldown_seconds = 180;
      else if(atrPoints >= 120.0)
         cooldown_seconds = 90;
      else
         cooldown_seconds = 45;
   }

   if(g_currentDailyLossPct >= g_maxDailyLossPct || g_currentDrawdownPct >= g_maxDrawdownPct)
      g_killSwitchActive = true;
}

bool ShouldEvaluateEntry()
{
   datetime currentBar = iTime(_Symbol, g_RegimeTF, 0);
   if(currentBar <= 0)
      return false;

   if(g_lastSignalBar == 0)
   {
      g_lastSignalBar = currentBar;
      return true;
   }

   if(currentBar == g_lastSignalBar)
      return false;

   g_lastSignalBar = currentBar;
   return true;
}

int FindStrategyFromPositionHistory(const long positionId)
{
   if(positionId <= 0)
      return -1;

   int deals = HistoryDealsTotal();
   for(int i = deals - 1; i >= 0; i--)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0)
         continue;

      if(HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID) != positionId)
         continue;

      long entry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_IN && entry != DEAL_ENTRY_INOUT)
         continue;

      string comment = HistoryDealGetString(dealTicket, DEAL_COMMENT);
      int marker = StringFind(comment, "|S");
      if(marker < 0)
         continue;

      string strategyText = StringSubstr(comment, marker + 2);
      return (int)StringToInteger(strategyText);
   }

   return -1;
}

int CurrentDayKey()
{
   MqlDateTime now;
   TimeToStruct(TimeGMT(), now);
   return (now.year * 10000) + (now.mon * 100) + now.day;
}
