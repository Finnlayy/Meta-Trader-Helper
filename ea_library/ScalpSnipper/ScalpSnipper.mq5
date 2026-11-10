//+------------------------------------------------------------------+
//| ScalpSnipper.mq5                                                 |
//| Expert Advisor: ScalpSnipper | Version 1.00 | 2026-03-26         |
//| Copyright 2026, FinnP                                            |
//| Beschreibung: Finaler, minimalistischer ONNX-Expert Advisor.     |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property copyright "2026, FinnP"
#property description "Produktionsreifer, minimalistischer MT5-Expert Advisor mit ONNX-Signalpfad."

#include "ScalpSnipper_Inputs.mqh"
#include "ScalpSnipper_Utils.mqh"
#include "ScalpSnipper_Risk.mqh"
#include "ScalpSnipper_Display.mqh"
#include "ScalpSnipper_Trade.mqh"

SSRuntimeSettings    g_settings;
CScalpSnipperEngine  g_engine;

int OnInit()
{
   SSLoadRuntimeFromInputs();
   SSDisplayInit();

   int initResult = g_engine.Init();
   if(initResult == INIT_SUCCEEDED && g_settings.enableTimer)
      EventSetTimer(g_settings.timerSeconds);

   SSDisplayRender(g_engine.Snapshot());
   return initResult;
}

void OnDeinit(const int reason)
{
   if(g_settings.enableTimer)
      EventKillTimer();

   g_engine.Shutdown(reason);
   SSDisplayShutdown();
}

void OnTick()
{
   g_engine.OnTick();
   SSDisplayRender(g_engine.Snapshot());
}

void OnTimer()
{
   g_engine.OnTimer();
   SSDisplayRender(g_engine.Snapshot());
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   g_engine.OnTradeTransaction(trans, request, result);
   SSDisplayRender(g_engine.Snapshot());
}
