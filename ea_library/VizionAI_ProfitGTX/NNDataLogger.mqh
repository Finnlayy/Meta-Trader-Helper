#ifndef NN_DATA_LOGGER_MQH
#define NN_DATA_LOGGER_MQH
//+------------------------------------------------------------------+
//|                                                  NNDataLogger.mqh |
//|  Real-trade labeling via MT5 deal history.                        |
//|  Phase 1 — NN_CaptureEntry(): snapshot features at trade open.    |
//|  Phase 2 — NN_LabelFromDeal(): write labeled row when trade closes.|
//|                                                                    |
//|  Replaces the old speculative 180-bar lookahead approach.          |
//+------------------------------------------------------------------+
#property strict

#include <Files\File.mqh>
#include "NNFeatures.mqh"
#include "InputParams.mqh"

// ─── Pending-entry store ─────────────────────────────────────────────────────

struct NNPendingEntry
{
   ulong    position_id;
   bool     is_buy;
   double   entry_price;
   datetime entry_time;
   string   setup_name;
   double   cluster_strength;
   double   conflict_score;
   int      category;           // 0 = continuation, 1 = counter
   double   features[12];
   int      n_features;
};

#define NN_MAX_PENDING 60        // safely above Max_Open_Trades (20) with headroom

NNPendingEntry g_nn_pending[NN_MAX_PENDING];
int            g_nn_pending_count = 0;

// ─── Phase 1: capture at trade open ─────────────────────────────────────────
//
// Call this immediately after a successful Trade.Buy() / Trade.Sell().
//   position_id — from HistoryDealGetInteger(entry_deal, DEAL_POSITION_ID)
//   is_buy      — true for long, false for short
//   setup       — reason string passed to Trade.Buy/Sell
//   cluster_strength, conflict_score — from Coordinator globals
//   category    — 0 = continuation, 1 = counter

void NN_CaptureEntry(ulong    position_id,
                     bool     is_buy,
                     const string setup,
                     double   cluster_strength,
                     double   conflict_score,
                     int      category)
{
   if(!NN_LogData) return;
   if(conflict_score > NN_MaxConflictToLog) return;
   if(g_nn_pending_count >= NN_MAX_PENDING) return;

   double feat[];
   int n = BuildNNFeatures(feat);
   if(n <= 0) return;

   int idx = g_nn_pending_count;

   g_nn_pending[idx].position_id      = position_id;
   g_nn_pending[idx].is_buy           = is_buy;
   g_nn_pending[idx].entry_price      = is_buy
                                        ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                                        : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   g_nn_pending[idx].entry_time       = TimeCurrent();
   g_nn_pending[idx].setup_name       = setup;
   g_nn_pending[idx].cluster_strength = cluster_strength;
   g_nn_pending[idx].conflict_score   = conflict_score;
   g_nn_pending[idx].category         = category;
   g_nn_pending[idx].n_features       = MathMin(n, 12);

   for(int i = 0; i < g_nn_pending[idx].n_features; i++)
      g_nn_pending[idx].features[i] = feat[i];

   g_nn_pending_count++;
}

// ─── Phase 2: label and write at trade close ─────────────────────────────────
//
// Call from OnTradeTransaction when entry == DEAL_ENTRY_OUT.
// deal_ticket must already be selected with HistoryDealSelect().

void NN_LabelFromDeal(ulong deal_ticket)
{
   if(!NN_LogData) return;

   ulong pos_id = (ulong)HistoryDealGetInteger(deal_ticket, DEAL_POSITION_ID);

   // Find the matching pending entry
   int idx = -1;
   for(int i = 0; i < g_nn_pending_count; i++)
   {
      if(g_nn_pending[i].position_id == pos_id)
      {
         idx = i;
         break;
      }
   }
   if(idx < 0) return;   // trade wasn't captured (manual trade or already labeled)

   double   profit     = HistoryDealGetDouble(deal_ticket,  DEAL_PROFIT);
   double   exit_price = HistoryDealGetDouble(deal_ticket,  DEAL_PRICE);
   datetime exit_time  = (datetime)HistoryDealGetInteger(deal_ticket, DEAL_TIME);
   int      dur_min    = (int)((exit_time - g_nn_pending[idx].entry_time) / 60);
   int      label      = (profit > 0.0) ? 1 : 0;   // 1 = win, 0 = loss/breakeven

   // Write CSV row
   int h = FileOpen(NN_LogFileName, FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI);
   if(h != INVALID_HANDLE)
   {
      FileSeek(h, 0, SEEK_END);

      if(FileSize(h) == 0)
      {
         FileWrite(h,
            "entry_time", "exit_time", "symbol", "tf",
            "is_buy", "category", "setup",
            "cluster_strength", "conflict_score",
            "entry_price", "exit_price",
            "profit", "label", "duration_min",
            "n_features", "features_json"
         );
      }

      string fjson = "[";
      for(int k = 0; k < g_nn_pending[idx].n_features; k++)
      {
         fjson += DoubleToString(g_nn_pending[idx].features[k], 8);
         if(k < g_nn_pending[idx].n_features - 1) fjson += ",";
      }
      fjson += "]";

      FileWrite(h,
         (string)g_nn_pending[idx].entry_time,
         (string)exit_time,
         _Symbol,
         (string)Period(),
         (g_nn_pending[idx].is_buy ? 1 : 0),
         g_nn_pending[idx].category,
         g_nn_pending[idx].setup_name,
         DoubleToString(g_nn_pending[idx].cluster_strength, 2),
         DoubleToString(g_nn_pending[idx].conflict_score,   2),
         DoubleToString(g_nn_pending[idx].entry_price, _Digits),
         DoubleToString(exit_price, _Digits),
         DoubleToString(profit, 2),
         label,
         dur_min,
         g_nn_pending[idx].n_features,
         fjson
      );

      FileClose(h);
   }

   // Remove from pending array (shift remaining entries down)
   for(int i = idx; i < g_nn_pending_count - 1; i++)
      g_nn_pending[i] = g_nn_pending[i + 1];
   g_nn_pending_count--;
}

#endif
