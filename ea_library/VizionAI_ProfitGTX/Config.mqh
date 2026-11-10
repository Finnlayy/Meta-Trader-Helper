#ifndef CONFIG_MQH
#define CONFIG_MQH

// Core market mode/state definitions used across modules.
enum MarketMode
{
   MODE_TRENDING = 0,
   MODE_RANGING  = 1,
   MODE_CHOP     = 2
};

enum TradeState
{
   STATE_CONTINUATION = 0,
   STATE_PULLBACK     = 1,
   STATE_REVERSAL     = 2
};

struct MasterSignal
{
   int    master_direction;   // -1 sell, 0 neutral, 1 buy
   double master_confidence;  // 0..100
   bool   should_trade;
   string structure_type;
   string reasoning;
};

#endif
