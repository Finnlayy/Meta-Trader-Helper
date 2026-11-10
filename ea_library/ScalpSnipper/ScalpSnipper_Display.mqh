//+------------------------------------------------------------------+
//| ScalpSnipper_Display.mqh                                         |
//| Expert Advisor: ScalpSnipper | Version 1.00 | 2026-03-26         |
//| Copyright 2026, FinnP                                            |
//| Beschreibung: Minimalistisches Chart-Panel per Comment().        |
//+------------------------------------------------------------------+
#ifndef __SCALPSNIPPER_DISPLAY_MQH__
#define __SCALPSNIPPER_DISPLAY_MQH__
#include "ScalpSnipper_Utils.mqh"

void SSDisplayInit()
{
   if(g_settings.showPanel)
      Comment("");
}

void SSDisplayShutdown()
{
   Comment("");
}

void SSDisplayRender(const SSPanelData &panel)
{
   if(!g_settings.showPanel)
   {
      Comment("");
      return;
   }

   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   string text =
      SS_APP_NAME + " v" + SS_APP_VERSION + " | " + panel.statusText + "\n" +
      "Balance: " + DoubleToString(panel.balance, 2) + " " + currency + "\n" +
      "Equity:  " + DoubleToString(panel.equity, 2) + " " + currency + "\n" +
      "Drawdown: " + DoubleToString(panel.drawdownPercent, 2) + "%\n" +
      "Offene Trades: " + IntegerToString(panel.openPositions) + "\n" +
      "Trades heute:  " + IntegerToString(panel.tradesToday) + "\n" +
      "Win-Rate:      " + DoubleToString(panel.winRate, 1) + "%\n" +
      "Spread:        " + DoubleToString(panel.spreadPoints, 1) + " Punkte\n" +
      "Signal:        " + panel.signalText + " (" + DoubleToString(panel.score, 4) + ")\n" +
      panel.modelText + "\n" +
      panel.detailText;

   Comment(text);
}

#endif // __SCALPSNIPPER_DISPLAY_MQH__
