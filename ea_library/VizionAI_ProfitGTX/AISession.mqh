#ifndef AI_SESSION_MQH
#define AI_SESSION_MQH

// ---------------------------------------------------------------------------
// AISession.mqh — Forex session detection + chart corner label
// Asia: 22:00-06:00 UTC | London: 07:00-12:00 UTC | NY: 13:00-17:00 UTC
// AMD: Accumulation | Manipulation | Distribution
// ---------------------------------------------------------------------------

string GetCurrentSession()
{
   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);
   int h = dt.hour;

   if(h >= 22 || h < 6)  return "Asia";
   if(h >= 7  && h < 12) return "London";
   if(h >= 13 && h < 17) return "NY";
   return "Interbank";
}

void InitAISession()
{
   GW_Session_Name = GetCurrentSession();
   GW_Session_Phase = "Unknown";
   GW_Session_Confidence = 0.0;
}

void UpdateSessionLabel()
{
   if(!AI_Session_Draw)
   {
      ObjectDelete(0, "GW_SESSION_LABEL");
      ObjectDelete(0, "GW_NEWS_LABEL");
      return;
   }

   // Session phase label
   string phase = StringLen(GW_Session_Phase) > 0 ? GW_Session_Phase : "?";
   string sess  = StringLen(GW_Session_Name)  > 0 ? GW_Session_Name  : GetCurrentSession();
   string text  = "  " + sess + " | " + phase;
   if(GW_Session_Confidence > 0.0)
      text += " (" + DoubleToString(GW_Session_Confidence, 0) + "%)";
   text += "  |  GW:" + GW_Status;

   string lbl = "GW_SESSION_LABEL";
   if(ObjectFind(0, lbl) < 0)
      ObjectCreate(0, lbl, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, lbl, OBJPROP_CORNER,    CORNER_LEFT_LOWER);
   ObjectSetInteger(0, lbl, OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(0, lbl, OBJPROP_YDISTANCE, 30);
   ObjectSetInteger(0, lbl, OBJPROP_COLOR,     clrSkyBlue);
   ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,  9);
   ObjectSetString( 0, lbl, OBJPROP_TEXT,      text);

   // News headline label (if any)
   if(StringLen(GW_News_Headlines) > 0)
   {
      string nlbl = "GW_NEWS_LABEL";
      if(ObjectFind(0, nlbl) < 0)
         ObjectCreate(0, nlbl, OBJ_LABEL, 0, 0, 0);
      string ntext = "  News: " + StringSubstr(GW_News_Headlines, 0, 100);
      ObjectSetInteger(0, nlbl, OBJPROP_CORNER,    CORNER_LEFT_LOWER);
      ObjectSetInteger(0, nlbl, OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, nlbl, OBJPROP_YDISTANCE, 48);
      ObjectSetInteger(0, nlbl, OBJPROP_COLOR,     clrKhaki);
      ObjectSetInteger(0, nlbl, OBJPROP_FONTSIZE,  8);
      ObjectSetString( 0, nlbl, OBJPROP_TEXT,      ntext);
   }
}

void CleanupSessionLabel()
{
   ObjectDelete(0, "GW_SESSION_LABEL");
   ObjectDelete(0, "GW_NEWS_LABEL");
}

#endif
