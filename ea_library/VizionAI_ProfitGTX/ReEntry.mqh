#ifndef REENTRY_MQH
#define REENTRY_MQH

bool OpenBuy(const string reason, double lot_multiplier = 1.0);
bool OpenSell(const string reason, double lot_multiplier = 1.0);

struct ReEntryCandidate
{
   bool active;
   bool is_buy;
   datetime closed_time;
   int attempts;
   string reason;
};

ReEntryCandidate g_reentry[16];

void InitReEntry()
{
   for(int i = 0; i < ArraySize(g_reentry); ++i)
   {
      g_reentry[i].active = false;
      g_reentry[i].is_buy = false;
      g_reentry[i].closed_time = 0;
      g_reentry[i].attempts = 0;
      g_reentry[i].reason = "";
   }
}

void QueueReEntryCandidate(const bool is_buy, const string reason)
{
   if(!Enable_ReEntry)
      return;

   for(int i = 0; i < ArraySize(g_reentry); ++i)
   {
      if(!g_reentry[i].active)
      {
         g_reentry[i].active = true;
         g_reentry[i].is_buy = is_buy;
         g_reentry[i].closed_time = TimeCurrent();
         g_reentry[i].attempts = 0;
         g_reentry[i].reason = reason;
         return;
      }
   }
}

bool CanReEnter(const int direction)
{
   if(direction > 0)
      return (Active_Praise_Signals >= Active_Warnings);
   if(direction < 0)
      return (Active_Warnings >= Active_Praise_Signals);
   return false;
}

void ExecuteReEntries()
{
   if(!Enable_ReEntry)
      return;

   for(int i = 0; i < ArraySize(g_reentry); ++i)
   {
      if(!g_reentry[i].active)
         continue;

      if(TimeCurrent() - g_reentry[i].closed_time < ReEntry_Cooldown)
         continue;

      if(g_reentry[i].attempts >= ReEntry_Max_Attempts)
      {
         g_reentry[i].active = false;
         continue;
      }

      int confirms = 0;
      if(g_reentry[i].is_buy)
      {
         if(IsBullBias()) confirms++;
         if(Trend_Resumption || Bull_MA50_Reclaimed()) confirms++;
         if(StochCrossUp() || Stoch_K_Current > Stoch_Mid) confirms++;
         if(Coordinator_Bias_Direction >= 0 && Coordinator_AllowTrade) confirms++;
      }
      else
      {
         if(IsBearBias()) confirms++;
         if(Trend_Resumption || Bear_MA50_Reclaimed()) confirms++;
         if(StochCrossDown() || Stoch_K_Current < Stoch_Mid) confirms++;
         if(Coordinator_Bias_Direction <= 0 && Coordinator_AllowTrade) confirms++;
      }

      if(Require_Stronger_Signal && confirms < 3)
         continue;

      string label = "RE-ENTRY " + IntegerToString(g_reentry[i].attempts + 1) + " | " + g_reentry[i].reason;

      bool ok = false;
      if(g_reentry[i].is_buy)
         ok = OpenBuy(label, 1.0);
      else
         ok = OpenSell(label, 1.0);

      if(ok)
      {
         g_reentry[i].attempts++;
         if(g_reentry[i].attempts >= ReEntry_Max_Attempts)
            g_reentry[i].active = false;
         else
            g_reentry[i].closed_time = TimeCurrent();
      }
      else
      {
         g_reentry[i].active = false;
      }
   }
}

#endif
