#ifndef __SMARKET_SNAPSHOT_MQH__
#define __SMARKET_SNAPSHOT_MQH__

struct SMarketSnapshot
{
   string          symbol;
   ENUM_TIMEFRAMES tf;
   datetime        ts_utc;
   datetime        bar_time;

   double          bid;
   double          ask;
   double          spread_points;

   double          atr14;
   double          ema50;
   double          ema200;
   double          rsi14;

   double          close[3];
   double          high[3];
   double          low[3];
   long            volume[3];

   bool            is_valid;
};

#endif // __SMARKET_SNAPSHOT_MQH__
