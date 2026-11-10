#ifndef __UI_MAIN_MQH__
#define __UI_MAIN_MQH__

#include <Controls\Dialog.mqh>
#include <Controls\Label.mqh>
#include <Controls\Edit.mqh>
#include <Controls\Button.mqh>
#include <Controls\ComboBox.mqh>
#include <Controls\CheckBox.mqh>

#include "../Core/Risk.mqh"
#include "../Core/Regime.mqh"
#include "../Core/Strategy.mqh"

extern double          g_riskPercent;
extern double          g_fixedLot;
extern ENUM_TIMEFRAMES g_RegimeTF;
extern string          g_ModelPath;
extern bool            g_useAI;
extern MarketRegime    currentRegime;
extern int             g_lastStrategy;

// UI state
CAppDialog g_UiDialog;
CLabel     g_lblHeader, g_lblRiskMode, g_lblLot, g_lblRiskPct, g_lblTF, g_lblModel, g_lblStatus;
CComboBox  g_cbRiskMode, g_cbTF;
CEdit      g_edLot, g_edRiskPct, g_edModel;
CCheckBox  g_chkAI;
CButton    g_btnApply, g_btnClose;

long g_uiChartId = 0;
bool g_uiReady   = false;
long g_overlayChartId = 0;

// overlay object names
string OVERLAY_BG  = "KI_AI_SUPER_TRADER_OVL_BG";
string OVERLAY_TXT = "KI_AI_SUPER_TRADER_OVL_TXT";

// Helpers
string DescribeTimeframe(const ENUM_TIMEFRAMES tf)
{
   switch(tf)
   {
      case PERIOD_M1 : return "M1";
      case PERIOD_M5 : return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1 : return "H1";
      case PERIOD_H4 : return "H4";
      case PERIOD_D1 : return "D1";
      default        : return "Custom";
   }
}

string DescribeRisk(const RiskMode mode)
{
   switch(mode)
   {
      case RISK_GAMBA   : return "Aggressive";
      case RISK_MODERATE: return "Moderate";
      case RISK_SAFE    : return "Safe";
      case RISK_ZERO    : return "Flat";
      case RISK_AI      : return "AI adaptive";
      default           : return "Unknown";
   }
}

string DescribeRegime(const MarketRegime regime)
{
   switch(regime)
   {
      case REGIME_TREND   : return "Trend";
      case REGIME_RANGE   : return "Range";
      case REGIME_HIGH_VOL: return "High Vol";
      case REGIME_LOW_VOL : return "Low Vol";
      default             : return "Unknown";
   }
}

string DescribeStrategy(const int strat)
{
   switch(strat)
   {
      case STRAT_TREND   : return "Trend follow";
      case STRAT_MEAN    : return "Mean revert";
      case STRAT_BREAKOUT: return "Breakout";
      default            : return "Custom";
   }
}

void AddTimeframeOptions()
{
   g_cbTF.AddItem("M1",  PERIOD_M1);
   g_cbTF.AddItem("M5",  PERIOD_M5);
   g_cbTF.AddItem("M15", PERIOD_M15);
   g_cbTF.AddItem("M30", PERIOD_M30);
   g_cbTF.AddItem("H1",  PERIOD_H1);
   g_cbTF.AddItem("H4",  PERIOD_H4);
   g_cbTF.AddItem("D1",  PERIOD_D1);
   g_cbTF.SelectByValue(g_RegimeTF);
}

bool InitUI(const bool separateChart)
{
   g_uiChartId = ChartID();
   if(g_uiChartId <= 0)
      return false;
   g_overlayChartId = g_uiChartId;

   // floating panel sized like MT5 controls sample
   int xOffset = 15;
   int yOffset = 30;

   if(!g_UiDialog.Create(g_uiChartId, "KI_AI_SUPER_TRADER_UI", 0, xOffset, yOffset, xOffset + 480, yOffset + 260))
      return false;
   g_UiDialog.Caption("KI AI Super Trader Controls");

   int row     = 18;
   int labelW  = 160;
   int inputX  = labelW + 25;
   int fieldW  = 220;

   g_lblHeader.Create(g_uiChartId, "lbl_header", 0, 10, row, 430, 20);
   g_lblHeader.Text("KI AI Super Trader Control");
   g_lblHeader.FontSize(12);
   g_lblHeader.Color(clrDodgerBlue);
   g_UiDialog.Add(g_lblHeader);
   row += 28;

   g_lblRiskMode.Create(g_uiChartId, "lbl_riskmode", 0, 10, row, labelW, 18);
   g_lblRiskMode.Text("Risk mode");
   g_UiDialog.Add(g_lblRiskMode);

   g_cbRiskMode.Create(g_uiChartId, "cb_riskmode", 0, inputX, row - 2, inputX + fieldW, row + 16);
   g_cbRiskMode.ListViewItems(5);
   g_cbRiskMode.AddItem("Aggressive (Gamba)", RISK_GAMBA);
   g_cbRiskMode.AddItem("Moderate", RISK_MODERATE);
   g_cbRiskMode.AddItem("Safe", RISK_SAFE);
   g_cbRiskMode.AddItem("Flat / Zero", RISK_ZERO);
   g_cbRiskMode.AddItem("AI adaptive", RISK_AI);
   g_cbRiskMode.SelectByValue(currentRisk);
   g_UiDialog.Add(g_cbRiskMode);
   row += 26;

   g_lblLot.Create(g_uiChartId, "lbl_lot", 0, 10, row, labelW, 18);
   g_lblLot.Text("Fixed lot (moderate/safe)");
   g_UiDialog.Add(g_lblLot);

   g_edLot.Create(g_uiChartId, "ed_lot", 0, inputX, row - 2, inputX + fieldW, row + 16);
   g_edLot.Text(DoubleToString(g_fixedLot, 2));
   g_UiDialog.Add(g_edLot);
   row += 26;

   g_lblRiskPct.Create(g_uiChartId, "lbl_riskpct", 0, 10, row, labelW, 18);
   g_lblRiskPct.Text("Risk % (AI mode)");
   g_UiDialog.Add(g_lblRiskPct);

   g_edRiskPct.Create(g_uiChartId, "ed_riskpct", 0, inputX, row - 2, inputX + fieldW, row + 16);
   g_edRiskPct.Text(DoubleToString(g_riskPercent, 2));
   g_UiDialog.Add(g_edRiskPct);
   row += 26;

   g_lblTF.Create(g_uiChartId, "lbl_tf", 0, 10, row, labelW, 18);
   g_lblTF.Text("Regime timeframe");
   g_UiDialog.Add(g_lblTF);

   g_cbTF.Create(g_uiChartId, "cb_tf", 0, inputX, row - 2, inputX + fieldW, row + 16);
   g_cbTF.ListViewItems(6);
   AddTimeframeOptions();
   g_UiDialog.Add(g_cbTF);
   row += 26;

   g_lblModel.Create(g_uiChartId, "lbl_model", 0, 10, row, labelW, 18);
   g_lblModel.Text("Model path (text)");
   g_UiDialog.Add(g_lblModel);

   g_edModel.Create(g_uiChartId, "ed_model", 0, inputX, row - 2, inputX + fieldW, row + 16);
   g_edModel.Text(g_ModelPath);
   g_UiDialog.Add(g_edModel);
   row += 26;

   g_chkAI.Create(g_uiChartId, "chk_ai", 0, 10, row, 200, row + 16);
   g_chkAI.Text("Blend AI scores");
   g_chkAI.Checked(g_useAI);
   g_UiDialog.Add(g_chkAI);
   row += 28;

   g_btnApply.Create(g_uiChartId, "btn_apply", 0, inputX, row, 100, row + 20);
   g_btnApply.Text("Apply");
   g_UiDialog.Add(g_btnApply);

   g_btnClose.Create(g_uiChartId, "btn_close", 0, inputX + 120, row, 100, row + 20);
   g_btnClose.Text("Hide UI");
   g_UiDialog.Add(g_btnClose);
   row += 30;

   g_lblStatus.Create(g_uiChartId, "lbl_status", 0, 10, row, 420, 20);
   g_lblStatus.Text("Waiting for input...");
   g_lblStatus.Color(clrSilver);
   g_UiDialog.Add(g_lblStatus);

   g_UiDialog.Run();
   g_uiReady = true;

    // create chart overlay for quick glance
    CreateOverlay();
    UpdateOverlay();

   return true;
}

void ApplyUISettings()
{
   if(!g_uiReady)
      return;

   RiskMode selectedRisk = (RiskMode)g_cbRiskMode.Value();
   if(selectedRisk >= RISK_GAMBA && selectedRisk <= RISK_AI)
      currentRisk = selectedRisk;

   double lot = StringToDouble(g_edLot.Text());
   if(lot > 0)
   {
      g_fixedLot = lot;
      lotSize    = lot;
   }

   double pct = StringToDouble(g_edRiskPct.Text());
   if(pct > 0)
      g_riskPercent = pct;

   ENUM_TIMEFRAMES tf = (ENUM_TIMEFRAMES)g_cbTF.Value();
   if(tf > 0)
      g_RegimeTF = tf;

   string path = g_edModel.Text();
   if(StringLen(path) > 0)
      g_ModelPath = path;

   g_useAI = g_chkAI.Checked();

   ApplyRiskMode();
   g_lblStatus.Text(StringFormat("Applied: %s | Lot %.2f | TF %s | AI %s", DescribeRisk(currentRisk), lotSize, DescribeTimeframe(g_RegimeTF), (g_chkAI.Checked() ? "on" : "off")));
}

void ShutdownUI()
{
   if(!g_uiReady)
      return;

   g_UiDialog.Destroy();
   g_uiReady = false;

   // clean overlay objects
   if(g_overlayChartId > 0)
   {
      ObjectDelete(g_overlayChartId, OVERLAY_TXT);
      ObjectDelete(g_overlayChartId, OVERLAY_BG);
   }
}

void UpdateUI()
{
   if(!g_uiReady)
      return;

   g_lblStatus.Text(StringFormat("Active: %s | Lot %.2f | TF %s", DescribeRisk(currentRisk), lotSize, DescribeTimeframe(g_RegimeTF)));
   UpdateOverlay();
}

void HandleUIEvent(const int id,const long &lparam,const double &dparam,const string &sparam)
{
   if(!g_uiReady)
      return;

   g_UiDialog.ChartEvent(id,lparam,dparam,sparam);

   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      if(sparam == "btn_apply")
         ApplyUISettings();
      else if(sparam == "btn_close")
         g_UiDialog.Hide();
   }
}

// ---------- Overlay helpers ----------
void CreateOverlay()
{
   if(g_overlayChartId <= 0)
      return;

   // background
   if(ObjectFind(g_overlayChartId, OVERLAY_BG) == -1)
   {
      ObjectCreate(g_overlayChartId, OVERLAY_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_XDISTANCE, 8);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_YDISTANCE, 40);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_XSIZE, 230);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_YSIZE, 90);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_COLOR, clrDodgerBlue);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_BGCOLOR, clrBlack);
      ObjectSetInteger(g_overlayChartId, OVERLAY_BG, OBJPROP_BACK, true);
   }

   // text label
   if(ObjectFind(g_overlayChartId, OVERLAY_TXT) == -1)
   {
      ObjectCreate(g_overlayChartId, OVERLAY_TXT, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(g_overlayChartId, OVERLAY_TXT, OBJPROP_XDISTANCE, 14);
      ObjectSetInteger(g_overlayChartId, OVERLAY_TXT, OBJPROP_YDISTANCE, 46);
      ObjectSetString(g_overlayChartId, OVERLAY_TXT, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(g_overlayChartId, OVERLAY_TXT, OBJPROP_FONTSIZE, 9);
      ObjectSetInteger(g_overlayChartId, OVERLAY_TXT, OBJPROP_COLOR, clrWhite);
   }
}

void UpdateOverlay()
{
   if(g_overlayChartId <= 0)
      return;

   string txt = StringFormat("Regime   : %s\nStrategy : %s\nRisk     : %s (lot %.2f)\nTF       : %s\nAI blend : %s",
                             DescribeRegime(currentRegime),
                             DescribeStrategy(g_lastStrategy),
                             DescribeRisk(currentRisk),
                             lotSize,
                             DescribeTimeframe(g_RegimeTF),
                             (g_useAI ? "on" : "off"));

   if(ObjectFind(g_overlayChartId, OVERLAY_TXT) != -1)
      ObjectSetString(g_overlayChartId, OVERLAY_TXT, OBJPROP_TEXT, txt);
}

#endif // __UI_MAIN_MQH__
