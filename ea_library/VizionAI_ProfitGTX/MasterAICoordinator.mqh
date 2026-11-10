#ifndef MASTER_AI_COORDINATOR_MQH
#define MASTER_AI_COORDINATOR_MQH

#include "ChartStructure.mqh"
#include "CandlePatterns.mqh"
#include "PatternCoordinator.mqh"
#include "NeuralNet.mqh"
#include "AIGateway.mqh"
#include "AISession.mqh"

bool g_use_nn         = true;
bool g_use_ai_gateway = false;
bool g_require_ai_validation = false;
MasterSignal g_master_signal;

bool InitializeMasterAI()
{
   InitializeChartStructure();
   InitializePatternDetection();
   if(g_use_nn)
      InitializeNeuralNet();

   g_master_signal.master_direction = 0;
   g_master_signal.master_confidence = 0.0;
   g_master_signal.should_trade = false;
   g_master_signal.structure_type = "UNKNOWN";
   g_master_signal.reasoning = "Not initialized";
   return true;
}

void CleanupMasterAI()
{
   CleanupStructureObjects();
   CleanupSessionLabel();
   g_master_signal.master_direction = 0;
   g_master_signal.master_confidence = 0.0;
   g_master_signal.should_trade = false;
   g_master_signal.structure_type = "CLEANUP";
   g_master_signal.reasoning = "AI state reset";
}

void SetUseNeuralNetwork(const bool enable)
{
   g_use_nn = enable;
   if(g_use_nn && !NN_Initialized)
      InitializeNeuralNet();
}

void SetUseAIGateway(const bool enable) { g_use_ai_gateway = enable; }
void SetRequireAIValidation(const bool enable) { g_require_ai_validation = enable; }

// Legacy shim for old callers
void SetUseOpenAI(const bool enable) { SetUseAIGateway(enable); }

void UpdateMasterAI()
{
   DetectMarketStructure();
   DetectAllCandlestickPatterns();
   UpdatePatternCoordinator();

   int pattern_warns  = GetPatternWarnCount()   + PatternComboWarn;
   int pattern_praise = GetPatternPraiseCount() + PatternComboPraise;

   int dir = 0;
   if(IsBullBias()) dir =  1;
   if(IsBearBias()) dir = -1;

   if(g_use_nn)
      UpdateNeuralNetSignal();

   double nn_conf_bonus = 0.0;
   if(g_use_nn && NN_IsUsable())
   {
      if(NN_Bias ==  dir) nn_conf_bonus =  NN_Confidence * 0.25;
      if(NN_Bias == -dir) nn_conf_bonus = -NN_Confidence * 0.25;
   }

   double combo_score    = (double)(Active_Praise_Signals + pattern_praise)
                         - (double)(Active_Warnings       + pattern_warns);
   double structure_score = (double)GetStructureStrength() * 0.30;
   double confidence = MathMax(0.0, MathMin(100.0,
                         50.0 + combo_score * 5.0 + structure_score + nn_conf_bonus));

   g_master_signal.master_direction  = dir;
   g_master_signal.master_confidence = confidence;
   g_master_signal.structure_type    = GetStructureString();
   g_master_signal.reasoning         = "Combo matrix + patterns + structure";

   if(DoubleTopAtFib)    g_master_signal.reasoning += " + DoubleTop@Fib";
   if(DoubleBottomAtFib) g_master_signal.reasoning += " + DoubleBottom@Fib";

   if(g_use_nn && NN_IsUsable())
      g_master_signal.reasoning += " + NN(" + IntegerToString(NN_Bias) +
                                   "," + DoubleToString(NN_Confidence, 1) + "%)";

   if(g_use_ai_gateway && GW_Initialized)
      g_master_signal.reasoning += " + GW(" + GW_Status + ")";

   if(g_require_ai_validation)
      g_master_signal.should_trade = (confidence >= 75.0 && dir != 0);
   else
      g_master_signal.should_trade = (confidence >= 60.0 && dir != 0);
}

MasterSignal GetMasterSignal()
{
   return g_master_signal;
}

#endif
