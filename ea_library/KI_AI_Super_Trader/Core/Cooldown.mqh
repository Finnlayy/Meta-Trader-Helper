#ifndef __COOLDOWN_MQH__
#define __COOLDOWN_MQH__

// Simple cooldown helper to prevent overtrading

int last_trade_time = 0;
int cooldown_seconds = 60;

bool CanOpenTrade()
{
   int now = (int)TimeCurrent();
   if(now - last_trade_time < cooldown_seconds) return false;
   return true;
}

void MarkTradeOpened()
{
   last_trade_time = (int)TimeCurrent();
}

#endif // __COOLDOWN_MQH__
