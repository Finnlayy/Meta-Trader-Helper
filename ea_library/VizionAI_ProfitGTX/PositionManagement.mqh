#ifndef POSITION_MANAGEMENT_MQH
#define POSITION_MANAGEMENT_MQH

void QueueReEntryCandidate(const bool is_buy, const string reason);

void ManagePositions()
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   static ulong prev_tickets[64];
   static bool  prev_is_buy[64];
   static int prev_count = 0;

   ulong cur_tickets[64];
   int cur_count = 0;

   for(int i = PositionsTotal() - 1; i >= 0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;

      bool is_buy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);

      if(cur_count < 64)
      {
         cur_tickets[cur_count] = ticket;
         cur_count++;
      }

      double profit_points = is_buy ? ((bid - entry) / _Point) : ((entry - ask) / _Point);

      if(profit_points >= BE_Trigger_Points)
      {
         double be_sl = entry;
         if((is_buy && (sl < be_sl || sl == 0.0)) || (!is_buy && (sl > be_sl || sl == 0.0)))
            Trade.PositionModify(ticket, NormalizePrice(be_sl), tp);
      }

      int trail = Trail_Counter_Points;
      if(Current_State == STATE_CONTINUATION)
         trail = Trail_Continuation_Points;
      if(Active_Praise_Signals >= 4)
         trail = Trail_Supreme_Points;

      if(profit_points > trail)
      {
         double new_sl = is_buy ? (bid - trail * _Point) : (ask + trail * _Point);
         new_sl = NormalizePrice(new_sl);

         if((is_buy && new_sl > sl) || (!is_buy && (sl == 0.0 || new_sl < sl)))
            Trade.PositionModify(ticket, new_sl, tp);
      }
   }

   // Detect recently closed positions for re-entry candidates.
   for(int p = 0; p < prev_count; ++p)
   {
      bool still_open = false;
      for(int c = 0; c < cur_count; ++c)
      {
         if(prev_tickets[p] == cur_tickets[c])
         {
            still_open = true;
            break;
         }
      }

      if(!still_open && Enable_ReEntry)
      {
         string why = "POST-CLOSE VALIDATION";
         QueueReEntryCandidate(prev_is_buy[p], why);
      }
   }

   prev_count = 0;
   for(int c2 = 0; c2 < cur_count && c2 < 64; ++c2)
   {
      if(PositionSelectByTicket(cur_tickets[c2]))
      {
         prev_tickets[prev_count] = cur_tickets[c2];
         prev_is_buy[prev_count] = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
         prev_count++;
      }
   }
}

#endif
