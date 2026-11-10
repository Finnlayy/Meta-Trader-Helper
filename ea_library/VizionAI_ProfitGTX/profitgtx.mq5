//+------------------------------------------------------------------+
//|                                                     profitgtx.mq5 |
//|   Trading EA entrypoint (profitgtx)                               |
//|   Base: AlgoForge RSI-Stoch-MA-EA modular v5.8                     |
//|   Extensions: News bias, SignalCoordinator, NN logging, AI Gateway|
//+------------------------------------------------------------------+
#property copyright "QuarterTheory x VIZION"
#property version   "7.10"
#property strict

#include <Trade/Trade.mqh>
CTrade Trade;

// Base configuration
#include "Config.mqh"
#include "InputParams.mqh"
#include "GlobalVariables.mqh"

// Utilities + core systems
#include "Utilities.mqh"
#include "Indicators.mqh"
#include "FibLevels.mqh"
#include "Warnings.mqh"
#include "Praise.mqh"
#include "PatternCoordinator.mqh"

// Advanced systems
#include "MarketState.mqh"
#include "ReEntry.mqh"
#include "PositionManagement.mqh"
#include "TradeExecution.mqh"
#include "SignalCoordinator.mqh"
#include "NewsEngine.mqh"
#include "ChartLabels.mqh"
#include "TradingSetups.mqh"

// AI systems
#include "AISignalConfirmation.mqh"
#include "MasterAICoordinator.mqh"

int OnInit()
{
   // Trade object config
   Trade.SetExpertMagicNumber(MagicNumber);
   Trade.SetDeviationInPoints(50);
   Trade.SetTypeFilling(ORDER_FILLING_FOK);

   if(!InitializeIndicators())
      return INIT_FAILED;

   ArrayInitialize(SetupCount, 0);
   ArrayInitialize(LastEntryTime, 0);

   InitializeSignalCoordinator();
   ApplySymbolProfile();
   InitReEntry();
   InitNewsEngine();
   UpdateNewsEngine();

   CalculateLevels();
   if(Show_Levels) DrawLevels();

   // Resolve live URLs (AUTO probes internal NN; LAPTOP/CONTAINER use fixed set)
   // Must run before InitializeAIGateway() which uses g_gw_url
   AutoDetectDeployment();

   // AI Gateway (advisory: EA starts even if gateway is unreachable)
   bool gw_ok = InitializeAIGateway();
   if(!gw_ok)
      return INIT_FAILED;  // Only fails when AI_Mode="mandatory" and gateway is down

   InitAISession();

   if(!InitializeMasterAI())
   {
      // Master AI unavailable — EA runs with NN + pattern system only
   }
   else
   {
      SetUseNeuralNetwork(true);
      SetUseAIGateway(AI_Mode != "off");
      SetRequireAIValidation(AI_Mode == "mandatory");
   }

   // Fetch initial D1 briefing if gateway is active
   if(GW_Initialized && AI_Briefing_D1)
   {
      GW_Brief_D1 = AIFetchBriefing("D1");
      if(StringLen(GW_Brief_D1) > 0)
         DisplayAIBriefing(GW_Brief_D1);
      Last_GW_Briefing_D1 = TimeCurrent();
   }

   EventSetTimer(MathMax(5, News_Update_Seconds));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ReleaseIndicators();
   CleanupLevels();
   CleanupLabels();
   CleanupMasterAI();
}

void OnTimer()
{
   UpdateNewsEngine();

   if(!GW_Initialized || AI_Mode == "off")
      return;

   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);

   // H1 briefing — refresh when a new H1 bar has opened
   if(AI_Briefing_H1 && now - Last_GW_Briefing_H1 >= 3600)
   {
      string b = AIFetchBriefing("H1");
      if(StringLen(b) > 0) GW_Brief_H1 = b;
      Last_GW_Briefing_H1 = now;
   }

   // H4 briefing — refresh every 4 hours
   if(AI_Briefing_H4 && now - Last_GW_Briefing_H4 >= 14400)
   {
      string b = AIFetchBriefing("H4");
      if(StringLen(b) > 0) GW_Brief_H4 = b;
      Last_GW_Briefing_H4 = now;
      AIFetchSessionBriefing();
   }

   // D1 briefing — at configured hour, at most once per day
   if(AI_Briefing_D1 && dt.hour == AI_Briefing_Hour && now - Last_GW_Briefing_D1 > 3600)
   {
      string b = AIFetchBriefing("D1");
      if(StringLen(b) > 0)
      {
         GW_Brief_D1 = b;
         DisplayAIBriefing(b);
      }
      Last_GW_Briefing_D1 = now;
   }
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &request,
                        const MqlTradeResult      &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   ulong deal_ticket = trans.deal;
   if(!HistoryDealSelect(deal_ticket))
      return;

   long entry = HistoryDealGetInteger(deal_ticket, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT)
      return;  // Only process closing deals

   // Label and write the NN training record for this closed trade
   NN_LabelFromDeal(deal_ticket);

   double profit    = HistoryDealGetDouble(deal_ticket,  DEAL_PROFIT);
   string symbol    = HistoryDealGetString(deal_ticket,  DEAL_SYMBOL);
   long   deal_type = HistoryDealGetInteger(deal_ticket, DEAL_TYPE);
   string direction = (deal_type == DEAL_TYPE_BUY) ? "BUY" : "SELL";

   // Duration approximation: time from open to close (seconds → minutes)
   datetime open_time = (datetime)HistoryDealGetInteger(deal_ticket, DEAL_TIME);
   int duration_min   = (int)((TimeCurrent() - open_time) / 60);

   AIReportTrade(profit, "auto", direction, duration_min);
}

void OnTick()
{
   UpdateIndicators();
   UpdateMasterAI();

   DetectWarnings();
   DetectPraiseSignals();

   static int tick_count = 0;
   tick_count++;
   if(tick_count >= 100)
   {
      CalculateLevels();
      if(Show_Levels) DrawLevels();
      tick_count = 0;
   }

   UpdateModeAndState();
   CoordinateAllSignals();

   ManagePositions();

   ExecuteReEntries();
   ExecuteMARetestAndRejectionSetups();
   ExecuteContinuationSetups();
   ExecuteRangeSetups();
   ExecuteChopSetups();
   ExecuteForceEntrySetups();

   UpdateLabels();
}
