#property strict
#property script_show_inputs
#property version   "1.1"
#property description "KI AI TRADER"
#property copyright "Copyright (c) 2026, User"

#include "Core/Regime.mqh"
#include "Core/AI.mqh"
#include "Core/Strategy.mqh"
#include "Core/Execution.mqh"
#include "Core/Risk.mqh"
#include "Core/Exit.mqh"
#include "Core/Memory.mqh"

#include "UI/UI_Main.mqh"

input RiskMode        InpRiskMode        = RISK_MODERATE;            // initial risk mode
input double          InpFixedLot        = 0.01;                     // fixed lot when using moderate/safe
input double          InpRiskPercent     = 1.0;                      // percent of balance for AI mode
input ENUM_TIMEFRAMES InpRegimeTF        = PERIOD_M5;                // timeframe for regime detection
input bool            InpUseAI           = true;                     // enable AI score blending
input string          InpModelPath       = "Models/model.onnx";      // path to AI model (informational)
input bool            InpSeparateUIChart = true;                     // open UI on a secondary chart

double          g_riskPercent = 1.0;
double          g_fixedLot    = 0.01;
ENUM_TIMEFRAMES g_RegimeTF    = PERIOD_M5;
string          g_ModelPath   = "Models/model.onnx";
bool            g_useAI       = true;
int             g_lastStrategy = STRAT_MEAN;

void UpdateMarket();

int OnInit()
{
   g_riskPercent = InpRiskPercent;
   g_fixedLot    = InpFixedLot;
   g_RegimeTF    = InpRegimeTF;
   g_ModelPath   = InpModelPath;
   g_useAI       = InpUseAI;

   LoadMemory();

   currentRisk = InpRiskMode;
   lotSize     = g_fixedLot;
   ApplyRiskMode();

   if(!InitUI(InpSeparateUIChart))
      Print("UI initialization failed; running headless");

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
   ExecuteStrategy(strategy);

   ManagePositions();
   UpdateUI();
}

void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam)
{
   HandleUIEvent(id,lparam,dparam,sparam);
}

void OnDeinit(const int reason)
{
   SaveStats();
   ShutdownUI();
}

