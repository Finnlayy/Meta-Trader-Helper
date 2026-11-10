#ifndef CHART_LABELS_MQH
#define CHART_LABELS_MQH

#include "AILabels.mqh"

string STATUS_LABEL = "VZ_STATUS";

void UpdateLabels()
{
   string bias = "NEUTRAL";
   if(IsBullBias()) bias = "BULL";
   if(IsBearBias()) bias = "BEAR";

   string coord = Coordinator_AllowTrade ? "ALLOW" : "BLOCK";
   string news_dir = (News_Bias_Direction > 0 ? "BULL" : News_Bias_Direction < 0 ? "BEAR" : "NEUTRAL");

   string text = "Mode:" + ModeToString(Current_Mode) +
                 " | State:" + StateToString(Current_State) +
                 " | Bias:" + bias +
                 " | W:" + IntegerToString(Active_Warnings) +
                 " | P:" + IntegerToString(Active_Praise_Signals) +
                 " | ADX:" + DoubleToString(Current_ADX, 1) +
                 " | StochK:" + DoubleToString(Stoch_K_Current, 1) +
                 " | Coord:" + coord +
                 " | CStr:" + DoubleToString(Coordinator_Cluster_Strength, 1) +
                 " | CConf:" + DoubleToString(Coordinator_Conflict_Score, 1) +
                 " | NN:" + IntegerToString(NN_Bias) + "/" + DoubleToString(NN_Confidence, 0) +
                 " | News:" + news_dir + "/" + DoubleToString(News_Bias_Strength, 0) +
                 (News_Trade_Block_Active ? " BLOCK" : "");

   if(ObjectFind(0, STATUS_LABEL) < 0)
      ObjectCreate(0, STATUS_LABEL, OBJ_LABEL, 0, 0, 0);

   ObjectSetInteger(0, STATUS_LABEL, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, STATUS_LABEL, OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(0, STATUS_LABEL, OBJPROP_YDISTANCE, 15);
   ObjectSetInteger(0, STATUS_LABEL, OBJPROP_COLOR, clrWhite);
   ObjectSetString(0, STATUS_LABEL, OBJPROP_TEXT, text);

   UpdateAILabel();
   UpdateSessionLabel();
}

void CleanupLabels()
{
   ObjectDelete(0, STATUS_LABEL);
   CleanupAILabels();
   CleanupSessionLabel();
}

#endif
