//+------------------------------------------------------------------+
//| ScalpSnipper_Inputs.mqh                                          |
//| Expert Advisor: ScalpSnipper | Version 1.00 | 2026-03-26         |
//| Copyright 2026, FinnP                                            |
//| Beschreibung: Alle Input-Parameter fuer den finalen EA.          |
//+------------------------------------------------------------------+
#ifndef __SCALPSNIPPER_INPUTS_MQH__
#define __SCALPSNIPPER_INPUTS_MQH__

enum SSLotsMode
{
   SS_LOTS_FIXED        = 0,
   SS_LOTS_RISK_PERCENT = 1
};

enum SSTradeDirection
{
   SS_DIRECTION_BOTH       = 0,
   SS_DIRECTION_LONG_ONLY  = 1,
   SS_DIRECTION_SHORT_ONLY = 2
};

//--- Allgemein
input long              InpMagicNumber         = 551337;               // Magic Number
input bool              InpShowPanel           = true;                 // Status-Panel im Chart anzeigen
input bool              InpOnlyNewBar          = true;                 // Signale nur auf neuer Kerze bewerten

//--- Handelsregeln (Entry/Exit)
input SSTradeDirection  InpTradeDirection      = SS_DIRECTION_BOTH;    // Handelsrichtung
input double            InpSignalThreshold     = 0.20;                 // Schwellwert fuer Buy/Sell-Signal
input bool              InpCloseOnOpposite     = true;                 // Position bei Gegensignal schliessen
input int               InpCooldownSeconds     = 5;                    // Pause nach Exit in Sekunden

//--- Risikomanagement
input SSLotsMode        InpLotsMode            = SS_LOTS_FIXED;        // Positionsgroesse: fest oder Risiko
input double            InpFixedLots           = 0.10;                 // Feste Lot-Groesse
input double            InpRiskPercent         = 1.00;                 // Risiko pro Trade in Prozent
input int               InpStopLossPoints      = 180;                  // Stop Loss in Punkten
input int               InpTakeProfitPoints    = 240;                  // Take Profit in Punkten
input int               InpMaxSpreadPoints     = 25;                   // Maximaler Spread in Punkten
input int               InpSlippagePoints      = 20;                   // Maximale Abweichung in Punkten

//--- Anzeige / Visuals
input bool              InpLogDecisions        = true;                 // Entscheidungen ins Expert-Log schreiben
input bool              InpLogVerbose          = false;                // Ausfuehrliches Logging aktivieren

//--- Erweitert (fuer Experten)
input ENUM_TIMEFRAMES   InpFeatureTF           = PERIOD_M1;            // Zeitfenster fuer Features
input int               InpLookbackBars        = 64;                   // Anzahl historischer Kerzen
input int               InpFeatureCount        = 16;                   // Muss zum ONNX-Eingang passen
input string            InpModelPath           = "";                   // Optionaler Fallback-Pfad fuer externes ONNX-Modell
input bool              InpOnnxUseCPUOnly      = false;                // ONNX nur auf CPU ausfuehren
input int               InpOnnxOutputSize      = 1;                    // Muss zum ONNX-Ausgang passen
input bool              InpEnableTimer         = true;                 // Timer fuer Hintergrund-Refresh
input int               InpTimerSeconds        = 1;                    // Timer-Intervall in Sekunden
input bool              InpSelfTestOnInit      = true;                 // Feature- und ONNX-Selbsttest beim Start

#endif // __SCALPSNIPPER_INPUTS_MQH__
