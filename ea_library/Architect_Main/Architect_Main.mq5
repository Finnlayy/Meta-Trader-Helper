//+------------------------------------------------------------------+
//|                                           Architect_Main.mq5    |
//|                    THE ARCHITECT - Professional MT5 EA           |
//|                    V2.0 - Performance + Reliability Release      |
//|                                                                  |
//|  Strategies: TrendFollow | MeanReversion | ORB | Pullback        |
//|  Features:   TQA Filter | Dynamic Lot | Dynamic TP | Trailing    |
//|              + Walk-Forward Self-Optimization (Manager)          |
//|              + ONNX Model Gate | Training Data Collector         |
//|              + fast_json (ChatGPT / REST API ready)              |
//+------------------------------------------------------------------+
#property copyright "The Architect Team"
#property version   "2.00"
#property strict

//--- INPUTS --------------------------------------------------------
input group "=== GENERAL ==="
input ulong              Inp_MagicNumber      = 20241010;
input bool               Inp_TradingEnabled   = true;

input group "=== RISK ==="
input ENUM_RISK_PROFILES Inp_RiskProfile      = RISK_SAFE;
input double             Inp_BaseLotSize      = 0.01;
input double             Inp_MaxLotSize       = 0.10;
input bool               Inp_UseZeroLossMode  = false;

input group "=== DYNAMIC MODULES ==="
input bool               Inp_UseDynamicLot    = true;
input bool               Inp_UseDynamicTP     = true;
input bool               Inp_UseTrailingStop  = true;

input group "=== FILTERS ==="
input bool               Inp_UseTQAFilter     = true;
input double             Inp_TQA_MinThreshold = 0.38;
input bool               Inp_UseCooldown      = true;
input int                Inp_CooldownSeconds  = 10;

input group "=== TRADING HOURS (Server Time) ==="
input int                Inp_StartHour        = 8;
input int                Inp_StartMinute      = 30;
input int                Inp_EndHour          = 17;

input group "=== STRATEGY ==="
input int                Inp_ORBMinutes       = 60;
input int                Inp_EMA_Fast         = 50;
input int                Inp_EMA_Slow         = 200;
input int                Inp_ATR_Period       = 14;

input group "=== SELF-OPTIMIZATION (Manager) ==="
input bool               Inp_UseAutoOptim        = true;
input int                Inp_ReoptimHours        = 24;
input int                Inp_OptimHistoryBars    = 400;
input bool               Inp_ReoptimOnDrawdown   = true;
input double             Inp_ReoptimDDThreshold  = 0.05;

input group "=== AI / ONNX GATE ==="
input bool               Inp_UseOnnxGate      = false;  // Enable ONNX ensemble trade gate
input int                Inp_EnsembleMA_Period = 20;    // MA period for ONNX features (article default)

input group "=== DATA GENERATION (Training Mode) ==="
input bool               Inp_DataGenMode      = false;  // Collect OHLC+MA bar data to CSV (run in tester)

input group "=== SWAP CALENDAR (3x Wednesday Effect) ==="
input bool               Inp_UseSwapCalendar  = true;           // Apply 3x swap day TP boost
input double             Inp_SwapTPBoostPct   = 25.0;           // TP boost % on swap day (default 25)

input group "=== TELEGRAM ALERTS ==="
input bool               Inp_TelegramEnabled  = false;          // Send trade alerts via Telegram bot
input string             Inp_TelegramToken    = "";             // Bot API token (from @BotFather)
input string             Inp_TelegramChatId   = "";             // Chat/channel ID

input group "=== VISUAL ORDER MANAGER ==="
input bool               Inp_ShowOrderLines   = true;           // Draw SL/TP/entry lines on chart

#include "Core/Helpers.mqh"
#include "Utils/Logger.mqh"
#include "Core/Memory.mqh"
#include "Core/Handles.mqh"
#include "Core/TQA_Filter.mqh"
#include "Core/Cooldown.mqh"
#include "Core/Risk.mqh"
#include "Core/DynamicLot.mqh"
#include "Core/Regime.mqh"
#include "Core/AI.mqh"
#include "Core/Strategy.mqh"
#include "Core/ParameterValidation.mqh"
#include "Core/Execution.mqh"
#include "Core/DynamicTP.mqh"
#include "Core/TrailingStop.mqh"
#include "Core/Exit.mqh"
#include "Core/Manager.mqh"
#include "Core/SwapCalendar.mqh"
#include "Core/DataCollector.mqh"
#include "UI/UI_Main.mqh"
#include "UI/UI_Tabs.mqh"
#include "UI/OrderVisualizer.mqh"
#include "Utils/FileIO.mqh"
#include "Utils/fast_json.mqh"
#include "Utils/Telegram.mqh"
#include "Trade/Trade.mqh"
#include "Risk.mqh"
datetime g_LastBar = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(!ValidateAllParameters())
      return INIT_PARAMETERS_INCORRECT;

   InitLogger();

   if(!ReinitHandles(Inp_EMA_Fast, Inp_EMA_Slow, Inp_ATR_Period, Inp_EnsembleMA_Period))
   {
      Print("[INIT] ERROR: Failed to create indicator handles");
      return INIT_FAILED;
   }

   InitExecution(Inp_MagicNumber);
   InitRegimeSystem();
   InitStrategy();
   InitCooldown();
   InitializeMemory();
   InitManager();

   // ONNX gate (optional)
   if(Inp_UseOnnxGate && !Inp_DataGenMode)
      InitOnnxPredictor();

   // Data collection mode (for training — typically run in tester only)
   if(Inp_DataGenMode)
      InitDataCollector();

   InitUI();

   LogPatchNote("2.0.0", "Architect V2.0 online. Logger/ONNX performance optimization + robustness block.");

   Print("========================================================");
   Print("  THE ARCHITECT V2.0 -- ONLINE");
   Print("  Symbol: ", _Symbol, "  TF: ", EnumToString((ENUM_TIMEFRAMES)Period()));
   Print("  Risk:   ", EnumToString(Inp_RiskProfile));
   Print("  TQA:    min=", Inp_TQA_MinThreshold);
   Print("  Optim:  every ", Inp_ReoptimHours, "h | bars=", Inp_OptimHistoryBars);
   Print("  ONNX:   ", (Inp_UseOnnxGate ? (gOnnxLoaded ? "ACTIVE" : "MODEL NOT FOUND") : "OFF"),
         "  DataGen: ", (Inp_DataGenMode ? "ON" : "OFF"));
   Print("  Swap:   ", (Inp_UseSwapCalendar ? StringFormat("ON (+%.0f%% TP on swap day)", Inp_SwapTPBoostPct) : "OFF"));
   Print("  Telegram: ", (Inp_TelegramEnabled ? "ON" : "OFF"),
         "  OrderLines: ", (Inp_ShowOrderLines ? "ON" : "OFF"));
   Print("========================================================");

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   ReleaseHandles();

   ReleaseStrategy();
   ReleaseOnnxPredictor();
   ReleaseMemory();
   RemoveOrderLines();
   DestroyUI();
   CloseLogger();

   Print("THE ARCHITECT V2.0 -- OFFLINE  reason=", reason);
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(!Inp_TradingEnabled) return;

   bool newBar = IsNewBar(g_LastBar);

   // Position management runs every tick
   ManagePositions(g_hATR);

   // Self-optimization check (runs on new bar only, skips if position open)
   if(newBar)
      RunManagerCycle();

   if(!newBar) goto update_ui;

   {
      gCurrentRegime   = DetectRegime(g_hEMA_Fast, g_hEMA_Slow, g_hATR);
      gCurrentStrategy = SelectStrategyByAI(gCurrentRegime);

      // Data-gen: write one bar row per new completed candle (article-style exporter)
      if(Inp_DataGenMode)
         OnNewBar_DataGen(g_hMA_Open, g_hMA_High, g_hMA_Low, g_hMA_Close);

      ApplyRiskProfile();

      // Wednesday 3x swap effect: boost TP on the rollover day
      ApplySwapCalendarTP(Inp_UseSwapCalendar, Inp_SwapTPBoostPct);

      if(!TQAAllowsTrade())       goto update_ui;
      if(!CooldownReady())        goto update_ui;
      if(!InTradingHours(Inp_StartHour, Inp_StartMinute, Inp_EndHour)) goto update_ui;
      if(gMgrState == MGR_RUNNING) goto update_ui;

      if(!HasOpenPosition())
      {
         ENUM_SIGNAL sig = GetSignal(gCurrentStrategy, g_hEMA_Fast, g_hEMA_Slow, g_hATR);
         if(sig != SIGNAL_NONE)
         {
            // ONNX ensemble gate: confirms trade direction via multi-horizon MA forecast
            if(Inp_UseOnnxGate && !Inp_DataGenMode)
            {
               int dir = (sig == SIGNAL_LONG) ? 1 : -1;
               if(!OnnxAIApprovesTrade(g_hMA_Open, g_hMA_High, g_hMA_Low, g_hMA_Close, dir))
                  goto update_ui;
            }

            // IB Rebate Mode removed — use standard dynamic lot
            double lot = CalcDynamicLot(g_hATR);

            bool opened = ExecuteTrade(sig, lot, g_hATR);

            if(opened)
            {
               if(Inp_TelegramEnabled)
               {
                  // Read entry/SL/TP from the just-opened position for the notification
                  for(int pi = 0; pi < PositionsTotal(); pi++)
                  {
                     if(PositionGetSymbol(pi) == _Symbol &&
                        PositionGetInteger(POSITION_MAGIC) == (long)Inp_MagicNumber)
                     {
                        TelegramTradeOpen(Inp_TelegramToken, Inp_TelegramChatId,
                                          sig,
                                          PositionGetDouble(POSITION_VOLUME),
                                          PositionGetDouble(POSITION_SL),
                                          PositionGetDouble(POSITION_TP),
                                          PositionGetDouble(POSITION_PRICE_OPEN));
                        break;
                     }
                  }
               }
            }

            // Data-gen mode: bar data is collected in the newBar section (not per-trade)
            (void)opened;
         }
      }
   }

   update_ui:
   if(Inp_ShowOrderLines) UpdateOrderLines();
   UpdateUI();
}

//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lp, const double &dp, const string &sp)
{
   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      string tabs[] = {"TRADE","AI","RISK","STATS","SET"};
      int tabCount = ArraySize(tabs);
      for(int i = 0; i < tabCount; i++)
      {
         if(sp == OBJ_PREFIX + "tab" + IntegerToString(i))
         {
            gActiveTab = (ENUM_DASH_TAB)i;
            DrawTabBar(5, 165);
         }
      }

      if(sp == OBJ_PREFIX + "btn_optim")
      {
         ForceOptimNow();
         Print("[UI] Manual optimization triggered");
      }
   }
}

// OnTradeTransaction: catches position close for Telegram notifications.
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &request,
                        const MqlTradeResult      &result)
{
   // A deal of type DEAL_ENTRY_OUT means a position was closed
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal))            return;

   if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != (long)Inp_MagicNumber)           return;

   if(Inp_TelegramEnabled)
   {
      double profit     = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                        + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                        + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
      double closePrice = HistoryDealGetDouble(trans.deal, DEAL_PRICE);

      // Retrieve entry price from the matching DEAL_ENTRY_IN deal
      double entryPrice = 0.0;
      ulong  posId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
      if(HistorySelectByPosition(posId))
      {
         for(int di = HistoryDealsTotal()-1; di >= 0; di--)
         {
            ulong ticket = HistoryDealGetTicket(di);
            if(HistoryDealGetInteger(ticket, DEAL_POSITION_ID) == posId &&
               (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY) == DEAL_ENTRY_IN)
            {
               entryPrice = HistoryDealGetDouble(ticket, DEAL_PRICE);
               break;
            }
         }
      }

      TelegramTradeClose(Inp_TelegramToken, Inp_TelegramChatId,
                         profit, entryPrice, closePrice);
   }
}
