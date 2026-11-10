#ifndef __EXIT_MQH__
#define __EXIT_MQH__

extern ENUM_TIMEFRAMES g_RegimeTF;
extern int             g_maxHoldingBars;
extern bool            g_snapshotReady;
extern SMarketSnapshot g_marketSnapshot;

double ReadAtrForExit()
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

bool ShouldExitOnSignal(const long type)
{
   if(type == POSITION_TYPE_BUY)
      return SignalShort() || SignalMeanRevertShort() || SignalBreakoutShort();

   if(type == POSITION_TYPE_SELL)
      return SignalLong() || SignalMeanRevertLong() || SignalBreakoutLong();

   return false;
}

bool HasExceededHoldingWindow(const ulong ticket)
{
   if(!PositionSelectByTicket(ticket) || g_maxHoldingBars <= 0)
      return false;

   datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
   int barsHeld = iBarShift(_Symbol, g_RegimeTF, openTime, false);
   return (barsHeld >= g_maxHoldingBars);
}

void TryProtectPosition(const ulong ticket, const double atr)
{
   if(!PositionSelectByTicket(ticket) || atr <= 0.0)
      return;

   string symbol  = PositionGetString(POSITION_SYMBOL);
   long   type    = PositionGetInteger(POSITION_TYPE);
   double open    = PositionGetDouble(POSITION_PRICE_OPEN);
   double current = PositionGetDouble(POSITION_PRICE_CURRENT);
   double sl      = PositionGetDouble(POSITION_SL);
   double tp      = PositionGetDouble(POSITION_TP);
   int    digits  = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

   double profitDistance = (type == POSITION_TYPE_BUY) ? (current - open) : (open - current);
   if(profitDistance <= 0.0)
      return;

   double breakEvenTrigger = atr * 0.9;
   double trailingTrigger  = atr * 1.5;

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action   = TRADE_ACTION_SLTP;
   req.position = ticket;
   req.symbol   = symbol;
   req.tp       = tp;

   bool shouldModify = false;
   double newSl = sl;

   if(profitDistance >= breakEvenTrigger)
   {
      double breakEvenSl = NormalizeDouble(open, digits);
      if(type == POSITION_TYPE_BUY)
      {
         if(sl <= 0.0 || breakEvenSl > sl)
         {
            newSl = breakEvenSl;
            shouldModify = true;
         }
      }
      else
      {
         if(sl <= 0.0 || breakEvenSl < sl)
         {
            newSl = breakEvenSl;
            shouldModify = true;
         }
      }
   }

   if(profitDistance >= trailingTrigger)
   {
      double trailSl = NormalizeDouble((type == POSITION_TYPE_BUY) ? (current - atr) : (current + atr), digits);
      if(type == POSITION_TYPE_BUY)
      {
         if(trailSl > newSl)
         {
            newSl = trailSl;
            shouldModify = true;
         }
      }
      else
      {
         if(newSl <= 0.0 || trailSl < newSl)
         {
            newSl = trailSl;
            shouldModify = true;
         }
      }
   }

   if(!shouldModify)
      return;

   req.sl = newSl;
   OrderSend(req, res);
}

void ManagePositions()
{
   double atr = ReadAtrForExit();
   int total = PositionsTotal();
   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      if(symbol != _Symbol)
         continue;

      long type = PositionGetInteger(POSITION_TYPE);
      if(HasExceededHoldingWindow(ticket))
      {
         PositionClose(ticket);
         continue;
      }

      if(ShouldExitOnSignal(type))
      {
         PositionClose(ticket);
         continue;
      }

      TryProtectPosition(ticket, atr);
   }
}

#endif // __EXIT_MQH__
