#ifndef __EXECUTION_MQH__
#define __EXECUTION_MQH__

#include <Trade\Trade.mqh>
#include "Risk.mqh"
#include "Strategy.mqh"
#include "Cooldown.mqh"
#include "Signals.mqh"

extern ENUM_TIMEFRAMES g_RegimeTF;
extern int             g_maxPositions;
extern double          g_maxSpreadPoints;
extern bool            g_sessionTradeAllowed;
extern bool            g_killSwitchActive;
extern bool            g_snapshotReady;
extern double          g_currentDailyLossPct;
extern double          g_currentDrawdownPct;
extern SMarketSnapshot g_marketSnapshot;

bool HasOpenPositionForSymbol(const string symbol)
{
   return PositionSelect(symbol);
}

int CountOpenPositions()
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol)
         count++;
   }
   return count;
}

string BuildStrategyComment(const int strategy)
{
   return StringFormat("KIAI|S%d", strategy);
}

ENUM_ORDER_TYPE_FILLING ResolveFillingMode(const string symbol)
{
   long supportedModes = 0;
   if(SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE, supportedModes))
   {
      if((supportedModes & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
         return ORDER_FILLING_FOK;
      if((supportedModes & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
         return ORDER_FILLING_IOC;
   }

   return ORDER_FILLING_RETURN;
}

double ReadAtrForExecution()
{
   ENUM_TIMEFRAMES tf = (g_RegimeTF > 0) ? g_RegimeTF : PERIOD_M5;
   int handle = iATR(_Symbol, tf, 14);
   if(handle == INVALID_HANDLE)
      return 0.0;

   double buffer[1];
   double atr = 0.0;
   if(CopyBuffer(handle, 0, 0, 1, buffer) > 0)
      atr = buffer[0];

   IndicatorRelease(handle);
   return atr;
}

bool SendMarketOrder(const ENUM_ORDER_TYPE type, const double requestedLot, const int strategy)
{
   double lot = NormalizeVolume(requestedLot);
   if(lot <= 0.0)
      return false;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return false;

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = _Symbol;
   req.volume       = lot;
   req.type         = type;
   req.price        = (type == ORDER_TYPE_BUY) ? tick.ask : tick.bid;
   req.deviation    = 20;
   req.type_filling = ResolveFillingMode(_Symbol);
   req.comment      = BuildStrategyComment(strategy);

   double atr = ReadAtrForExecution();
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(atr > 0.0)
   {
      double slDistance = atr * 1.5;
      double tpDistance = atr * 2.5;
      req.sl = NormalizeDouble((type == ORDER_TYPE_BUY) ? (req.price - slDistance) : (req.price + slDistance), digits);
      req.tp = NormalizeDouble((type == ORDER_TYPE_BUY) ? (req.price + tpDistance) : (req.price - tpDistance), digits);
   }

   if(!OrderSend(req, res))
   {
      PrintFormat("OrderSend failed for strategy %d: %d", strategy, GetLastError());
      return false;
   }

   if(res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED)
   {
      PrintFormat("Trade rejected for strategy %d, retcode=%d", strategy, res.retcode);
      return false;
   }

   MarkTradeOpened();
   return true;
}

void ExecuteStrategy(int strat)
{
   double lot = lotSize;
   if(lot <= 0.0)
      return;

   if(!g_snapshotReady || !g_marketSnapshot.is_valid)
      return;

   if(!CanOpenTrade())
      return;

   if(!g_sessionTradeAllowed)
      return;

   if(g_killSwitchActive)
      return;

   if(g_marketSnapshot.spread_points > g_maxSpreadPoints)
      return;

   if(CountOpenPositions() >= g_maxPositions)
      return;

   if(HasOpenPositionForSymbol(_Symbol))
      return;

   switch(strat)
   {
      case STRAT_TREND:
         if(SignalLong())
            SendMarketOrder(ORDER_TYPE_BUY, lot, strat);
         else if(SignalShort())
            SendMarketOrder(ORDER_TYPE_SELL, lot, strat);
         break;
      case STRAT_MEAN:
         if(SignalMeanRevertLong())
            SendMarketOrder(ORDER_TYPE_BUY, lot, strat);
         else if(SignalMeanRevertShort())
            SendMarketOrder(ORDER_TYPE_SELL, lot, strat);
         break;
      case STRAT_BREAKOUT:
         if(SignalBreakoutLong())
            SendMarketOrder(ORDER_TYPE_BUY, lot, strat);
         else if(SignalBreakoutShort())
            SendMarketOrder(ORDER_TYPE_SELL, lot, strat);
         break;
   }
}

// wrapper helpers expected by UI/voice code
void OpenBuyOrder(double lot)
{
   if(!SendMarketOrder(ORDER_TYPE_BUY, lot, STRAT_TREND))
      Print("OpenBuyOrder failed");
}

void OpenSellOrder(double lot)
{
   if(!SendMarketOrder(ORDER_TYPE_SELL, lot, STRAT_BREAKOUT))
      Print("OpenSellOrder failed");
}

bool PositionClose(const ulong ticket)
{
   if(!PositionSelectByTicket(ticket)) return false;

   string symbol = PositionGetString(POSITION_SYMBOL);
   double volume = PositionGetDouble(POSITION_VOLUME);
   long type = PositionGetInteger(POSITION_TYPE);

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action   = TRADE_ACTION_DEAL;
   req.position = ticket;
   req.symbol   = symbol;
   req.volume   = volume;
   req.type     = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   req.price    = (type == POSITION_TYPE_BUY) ? SymbolInfoDouble(symbol, SYMBOL_BID)
                                              : SymbolInfoDouble(symbol, SYMBOL_ASK);
   req.deviation = 20;
   req.type_filling = ResolveFillingMode(symbol);

   return OrderSend(req, res);
}

#endif // __EXECUTION_MQH__
