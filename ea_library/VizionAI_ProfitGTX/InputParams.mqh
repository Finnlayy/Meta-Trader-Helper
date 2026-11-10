#ifndef INPUT_PARAMS_MQH
#define INPUT_PARAMS_MQH

input long   MagicNumber                 = 580001;
input bool   Show_Levels                 = true;
input double BaseLotSize                 = 0.10;
input double War_Survivor_Lot_Multiplier = 2.5;

input bool   Use_Auto_Symbol_Config      = true;
input int    Manual_SL_Points            = 800;
input int    Manual_TP_Points            = 5000;
input double Manual_RR_Ratio             = 6.25;

input int    Trade_Cooldown_Seconds      = 300;
input int    Min_Active_Entries          = 4;
input int    Max_Open_Trades             = 20;

input int    Continuation_SL_Points      = 150;
input int    Continuation_TP_Points      = 4000;
input int    Counter_SL_Points           = 50;
input int    Counter_TP_Points           = 3000;

input int    BE_Trigger_Points           = 300;
input int    Trail_Continuation_Points   = 300;
input int    Trail_Counter_Points        = 150;
input int    Trail_Supreme_Points        = 100;

input int    MA_Touch_Buffer             = 75;
input int    Fib_Lookback_Bars           = 350;

input double Stoch_Oversold              = 20.0;
input double Stoch_Weak_Low              = 35.0;
input double Stoch_Mid                   = 50.0;
input double Stoch_Weak_High             = 65.0;
input double Stoch_Overbought            = 80.0;

input bool   Use_MA_Retest_Entries       = true;
input bool   Use_MA_Rejection_Entries    = true;
input int    MA_Retest_Cooldown_Seconds  = 60;

input bool   Enable_ReEntry              = true;
input int    ReEntry_Max_Attempts        = 2;
input int    ReEntry_Cooldown            = 30;
input bool   ReEntry_After_SL            = true;
input bool   ReEntry_After_BE            = true;
input bool   Require_Stronger_Signal     = true;

input bool   Use_Signal_Coordinator      = true;
input int    Conflict_Prevention_Seconds = 300;
input double Signal_Consensus_Threshold  = 0.60;
input double Min_Cluster_Strength        = 58.0;
input double Max_Cluster_Conflict        = 40.0;
input bool   Use_NN_In_Coordinator       = true;

// ── Deployment Profile ──────────────────────────────────────────────────────
// AUTO   = probe internal NN on init; use HTTPS if unreachable (laptop/VPN)
// LAPTOP = always use the public HTTPS endpoints
// CONTAINER = always use 127.0.0.1 (VNC / demo container with socat bridges)
input string DeploymentProfile           = "AUTO";
input string NN_URL_Internal             = "http://127.0.0.1:8000/predict";
input string NN_URL_Laptop               = "https://nn.vizionai.iamvisioncorp.org/predict";
input string GW_URL_Internal             = "http://127.0.0.1:32769/webhook/6VeJRjTNrrxCQK8u/webhook/ea-gateway";
input string GW_URL_Laptop               = "https://n8n.vizionai.iamvisioncorp.org/webhook/6VeJRjTNrrxCQK8u/webhook/ea-gateway";

input bool   Use_NeuralNet               = true;
input int    NN_TimeoutMs                = 3000;
input int    NN_CooldownSeconds          = 15;
input double NN_MinConfidenceToUse       = 55.0;
input double NN_MaxRiskToUse             = 70.0;
input bool   NN_DebugPrint               = false;

// NN dataset logging — captures features at actual trade open, labels at close
input bool   NN_LogData                  = true;
input string NN_LogFileName              = "nn_dataset_trades.csv";
input double NN_MaxConflictToLog         = 40.0;

// ── News Filter ─────────────────────────────────────────────────────────────
input bool   Use_News_Filter             = true;
input int    News_Update_Seconds         = 30;
input int    News_Lookback_Minutes       = 120;
input int    News_Lookahead_Minutes      = 60;
input int    News_HighImpact_Block_Minutes = 20;
// When true: trade IN the news direction during high-impact events (instead of hard-blocking)
// When false: block all trades during high-impact events (old behaviour)
input bool   Use_News_Directional_Trading   = true;
input double News_Directional_Min_Strength  = 20.0;  // min strength score to use directional mode

// ── AI Gateway ──────────────────────────────────────────────────────────────
// Routes through n8n → OpenRouter → Claude
// AI_Mode: advisory = trade if gateway down | mandatory = block if down | off = no AI calls
input string AI_Mode                     = "advisory";
input string AI_Gateway_Token            = "";
input int    AI_TimeoutMs                = 5000;
input bool   AI_Validate_Trades          = true;
input bool   AI_Briefing_H1              = true;
input bool   AI_Briefing_H4              = true;
input bool   AI_Briefing_D1              = true;
input int    AI_Briefing_Hour            = 7;
input bool   AI_Session_Draw             = true;

// Watchlist gate — skip trade entry if symbol rank > 10
input bool   Use_Watchlist_Gate          = false;

#endif
