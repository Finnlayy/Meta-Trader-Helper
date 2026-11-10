#ifndef AI_LABELS_MQH
#define AI_LABELS_MQH

void UpdateAILabel()
{
   color gw_color = clrGray;
   string gw_text = "GW: " + GW_Status;
   if(GW_Status == "ACTIVE")      gw_color = clrLime;
   if(GW_Status == "OFFLINE_ADVISORY") gw_color = clrOrange;
   if(GW_Status == "ERROR")       gw_color = clrRed;
   if(GW_Status == "DISABLED")    gw_color = clrDimGray;

   if(ObjectFind(0, "AILabel") < 0)
      ObjectCreate(0, "AILabel", OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, "AILabel", OBJPROP_CORNER,    CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, "AILabel", OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(0, "AILabel", OBJPROP_YDISTANCE, 20);
   ObjectSetString( 0, "AILabel", OBJPROP_TEXT,      gw_text);
   ObjectSetInteger(0, "AILabel", OBJPROP_COLOR,     gw_color);
   ObjectSetInteger(0, "AILabel", OBJPROP_FONTSIZE,  10);

   // Validation stats
   if(AI_Validate_Trades && GW_Initialized)
   {
      int total = AI_Validation_Accepts + AI_Validation_Rejects;
      double rate = (total > 0) ? ((double)AI_Validation_Accepts / total) * 100.0 : 0.0;
      string stats = "AI Val: +" + IntegerToString(AI_Validation_Accepts) +
                     " -" + IntegerToString(AI_Validation_Rejects) +
                     " (" + DoubleToString(rate, 0) + "%)";
      if(ObjectFind(0, "AIStatsLabel") < 0)
         ObjectCreate(0, "AIStatsLabel", OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, "AIStatsLabel", OBJPROP_CORNER,    CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, "AIStatsLabel", OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, "AIStatsLabel", OBJPROP_YDISTANCE, 40);
      ObjectSetString( 0, "AIStatsLabel", OBJPROP_TEXT,      stats);
      ObjectSetInteger(0, "AIStatsLabel", OBJPROP_COLOR,     clrYellow);
      ObjectSetInteger(0, "AIStatsLabel", OBJPROP_FONTSIZE,  9);
   }

   // Per-TF briefing display (right column, below stats)
   int y_offset = 60;
   if(StringLen(GW_Brief_H1) > 0)
   {
      string lbl = "AIBriefH1";
      if(ObjectFind(0, lbl) < 0) ObjectCreate(0, lbl, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, lbl, OBJPROP_CORNER,    CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, lbl, OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, lbl, OBJPROP_YDISTANCE, y_offset);
      ObjectSetString( 0, lbl, OBJPROP_TEXT,      StringSubstr(GW_Brief_H1, 0, 60));
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,     clrAqua);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,  8);
      y_offset += 16;
   }
   if(StringLen(GW_Brief_H4) > 0)
   {
      string lbl = "AIBriefH4";
      if(ObjectFind(0, lbl) < 0) ObjectCreate(0, lbl, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, lbl, OBJPROP_CORNER,    CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, lbl, OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, lbl, OBJPROP_YDISTANCE, y_offset);
      ObjectSetString( 0, lbl, OBJPROP_TEXT,      StringSubstr(GW_Brief_H4, 0, 60));
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,     clrAqua);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,  8);
      y_offset += 16;
   }
   if(StringLen(GW_Brief_D1) > 0)
   {
      string lbl = "AIBriefD1";
      if(ObjectFind(0, lbl) < 0) ObjectCreate(0, lbl, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, lbl, OBJPROP_CORNER,    CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, lbl, OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, lbl, OBJPROP_YDISTANCE, y_offset);
      ObjectSetString( 0, lbl, OBJPROP_TEXT,      StringSubstr(GW_Brief_D1, 0, 60));
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,     clrAqua);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,  8);
   }

   // Last AI decision in lower right
   if(StringLen(Last_AI_Analysis) > 0)
   {
      string lbl = "AIAnalysisBox";
      if(ObjectFind(0, lbl) < 0) ObjectCreate(0, lbl, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, lbl, OBJPROP_CORNER,    CORNER_RIGHT_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, lbl, OBJPROP_YDISTANCE, 60);
      ObjectSetString( 0, lbl, OBJPROP_TEXT,      StringSubstr(Last_AI_Analysis, 0, 120));
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,     clrSilver);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,  8);
   }
}

void CleanupAILabels()
{
   string labels[] = {"AILabel","AIStatsLabel","AIBriefH1","AIBriefH4","AIBriefD1","AIAnalysisBox"};
   for(int i = 0; i < ArraySize(labels); i++)
      ObjectDelete(0, labels[i]);
}

void DisplayAIBriefing(const string briefing)
{
   Last_AI_Analysis = briefing;
   Print("[AI BRIEFING] ", briefing);
   UpdateAILabel();
}

void DisplayAIValidation(const string setup, const bool approved, const string reasoning)
{
   Last_AI_Analysis = "GW Val " + setup + ": " + (approved ? "APPROVED" : "REJECTED") + " | " + reasoning;
   UpdateAILabel();
}

#endif
