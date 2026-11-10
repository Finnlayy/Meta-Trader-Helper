#ifndef CANDLE_PATTERNS_MQH
#define CANDLE_PATTERNS_MQH

enum ENUM_PATTERN_TYPE
{
   PATTERN_NONE,
   PATTERN_REVERSAL_BULLISH,
   PATTERN_REVERSAL_BEARISH,
   PATTERN_CONTINUATION_BULL,
   PATTERN_CONTINUATION_BEAR,
   PATTERN_INDECISION
};

enum ENUM_PATTERN_NAME
{
   PATT_HAMMER,
   PATT_INVERTED_HAMMER,
   PATT_HANGING_MAN,
   PATT_SHOOTING_STAR,
   PATT_DOJI,
   PATT_SPINNING_TOP,
   PATT_MARUBOZU_BULL,
   PATT_MARUBOZU_BEAR,
   PATT_ENGULFING_BULL,
   PATT_ENGULFING_BEAR,
   PATT_TWEEZER_TOP,
   PATT_TWEEZER_BOTTOM,
   PATT_THREE_WHITE_SOLDIERS,
   PATT_THREE_BLACK_CROWS,
   PATT_MORNING_STAR,
   PATT_EVENING_STAR,
   PATT_2_1_2_BULL_CONT,
   PATT_2_1_2_BEAR_CONT,
   PATT_3_1_2_BULL_REV,
   PATT_3_1_2_BEAR_REV
};

struct PatternSignal
{
   ENUM_PATTERN_NAME name;
   ENUM_PATTERN_TYPE type;
   string name_str;
   int strength;
   int candle_index;
   double pattern_price;
   datetime time;
   bool generates_warn;
   bool generates_praise;
   double adjusted_strength;
};

PatternSignal g_ActivePatterns[];
int g_PatternCount = 0;
const int MAX_PATTERNS = 100;

const double SHADOW_RATIO = 2.0;
const double DOJI_RATIO = 0.1;
const double ENGULF_RATIO = 1.0;

string GetPatternName(const ENUM_PATTERN_NAME name)
{
   switch(name)
   {
      case PATT_HAMMER: return "HAMMER";
      case PATT_INVERTED_HAMMER: return "INVERTED_HAMMER";
      case PATT_HANGING_MAN: return "HANGING_MAN";
      case PATT_SHOOTING_STAR: return "SHOOTING_STAR";
      case PATT_DOJI: return "DOJI";
      case PATT_SPINNING_TOP: return "SPINNING_TOP";
      case PATT_MARUBOZU_BULL: return "MARUBOZU_BULL";
      case PATT_MARUBOZU_BEAR: return "MARUBOZU_BEAR";
      case PATT_ENGULFING_BULL: return "ENGULFING_BULL";
      case PATT_ENGULFING_BEAR: return "ENGULFING_BEAR";
      case PATT_TWEEZER_TOP: return "TWEEZER_TOP";
      case PATT_TWEEZER_BOTTOM: return "TWEEZER_BOTTOM";
      case PATT_THREE_WHITE_SOLDIERS: return "THREE_WHITE_SOLDIERS";
      case PATT_THREE_BLACK_CROWS: return "THREE_BLACK_CROWS";
      case PATT_MORNING_STAR: return "MORNING_STAR";
      case PATT_EVENING_STAR: return "EVENING_STAR";
      case PATT_2_1_2_BULL_CONT: return "2-1-2_BULL_CONT";
      case PATT_2_1_2_BEAR_CONT: return "2-1-2_BEAR_CONT";
      case PATT_3_1_2_BULL_REV: return "3-1-2_BULL_REV";
      case PATT_3_1_2_BEAR_REV: return "3-1-2_BEAR_REV";
      default: return "UNKNOWN";
   }
}

bool IsBullishTrend(const MqlRates &rates[], const int index)
{
   if(index + 10 >= ArraySize(rates)) return false;

   double ma_fast = 0.0, ma_slow = 0.0;
   for(int i = index; i < index + 5; ++i) ma_fast += rates[i].close;
   for(int i = index; i < index + 10; ++i) ma_slow += rates[i].close;
   ma_fast /= 5.0;
   ma_slow /= 10.0;

   return (ma_fast > ma_slow);
}

bool IsBearishTrend(const MqlRates &rates[], const int index)
{
   return !IsBullishTrend(rates, index);
}

void AddPattern(const ENUM_PATTERN_NAME name,
                const ENUM_PATTERN_TYPE type,
                const int candle_idx,
                const double price,
                const datetime time,
                const int strength)
{
   if(g_PatternCount >= MAX_PATTERNS) return;

   PatternSignal signal;
   signal.name = name;
   signal.type = type;
   signal.name_str = GetPatternName(name);
   signal.strength = strength;
   signal.candle_index = candle_idx;
   signal.pattern_price = price;
   signal.time = time;
   signal.generates_warn = false;
   signal.generates_praise = false;
   signal.adjusted_strength = (double)strength;

   g_ActivePatterns[g_PatternCount++] = signal;
}

void DetectSingleCandlePatterns(const MqlRates &rates[])
{
   int idx = 1;
   if(idx >= ArraySize(rates)) return;

   double o = rates[idx].open;
   double h = rates[idx].high;
   double l = rates[idx].low;
   double c = rates[idx].close;

   double body = MathAbs(c - o);
   double range = h - l;
   if(range <= 0.0) return;

   double up_shadow = h - MathMax(o, c);
   double lo_shadow = MathMin(o, c) - l;

   if(lo_shadow >= SHADOW_RATIO * body && up_shadow <= 0.3 * body && IsBearishTrend(rates, idx))
      AddPattern(PATT_HAMMER, PATTERN_REVERSAL_BULLISH, idx, l, rates[idx].time, 85);

   if(up_shadow >= SHADOW_RATIO * body && lo_shadow <= 0.3 * body && IsBullishTrend(rates, idx))
      AddPattern(PATT_SHOOTING_STAR, PATTERN_REVERSAL_BEARISH, idx, h, rates[idx].time, 85);

   if(body / range < DOJI_RATIO)
      AddPattern(PATT_DOJI, PATTERN_INDECISION, idx, c, rates[idx].time, 60);

   if(body / range > 0.9)
   {
      if(c > o) AddPattern(PATT_MARUBOZU_BULL, PATTERN_CONTINUATION_BULL, idx, c, rates[idx].time, 80);
      if(c < o) AddPattern(PATT_MARUBOZU_BEAR, PATTERN_CONTINUATION_BEAR, idx, c, rates[idx].time, 80);
   }
}

void DetectTwoCandlePatterns(const MqlRates &rates[])
{
   if(ArraySize(rates) < 3) return;

   int curr = 1, prev = 2;
   double o1 = rates[prev].open, c1 = rates[prev].close;
   double o2 = rates[curr].open, c2 = rates[curr].close;
   double b1 = MathAbs(c1 - o1), b2 = MathAbs(c2 - o2);

   if(c1 < o1 && c2 > o2 && o2 <= c1 && c2 >= o1 && b2 > b1 * ENGULF_RATIO)
      AddPattern(PATT_ENGULFING_BULL, PATTERN_REVERSAL_BULLISH, curr, c2, rates[curr].time, 90);

   if(c1 > o1 && c2 < o2 && o2 >= c1 && c2 <= o1 && b2 > b1 * ENGULF_RATIO)
      AddPattern(PATT_ENGULFING_BEAR, PATTERN_REVERSAL_BEARISH, curr, c2, rates[curr].time, 90);

   if(MathAbs(rates[prev].high - rates[curr].high) <= (rates[prev].high - rates[prev].low) * 0.02)
      AddPattern(PATT_TWEEZER_TOP, PATTERN_REVERSAL_BEARISH, curr, rates[curr].high, rates[curr].time, 75);

   if(MathAbs(rates[prev].low - rates[curr].low) <= (rates[prev].high - rates[prev].low) * 0.02)
      AddPattern(PATT_TWEEZER_BOTTOM, PATTERN_REVERSAL_BULLISH, curr, rates[curr].low, rates[curr].time, 75);
}

void DetectThreeCandlePatterns(const MqlRates &rates[])
{
   if(ArraySize(rates) < 4) return;

   int c1 = 3, c2 = 2, c3 = 1;

   if(rates[c1].close > rates[c1].open && rates[c2].close > rates[c2].open && rates[c3].close > rates[c3].open &&
      rates[c2].close > rates[c1].close && rates[c3].close > rates[c2].close)
      AddPattern(PATT_THREE_WHITE_SOLDIERS, PATTERN_CONTINUATION_BULL, c3, rates[c3].close, rates[c3].time, 90);

   if(rates[c1].close < rates[c1].open && rates[c2].close < rates[c2].open && rates[c3].close < rates[c3].open &&
      rates[c2].close < rates[c1].close && rates[c3].close < rates[c2].close)
      AddPattern(PATT_THREE_BLACK_CROWS, PATTERN_CONTINUATION_BEAR, c3, rates[c3].close, rates[c3].time, 90);
}

void DetectTheStratPatterns(const MqlRates &rates[])
{
   if(ArraySize(rates) < 4) return;

   int st[3] = {0, 0, 0};
   for(int i = 1; i <= 3; ++i)
   {
      int curr = i;
      int prev = i + 1;

      if(rates[curr].high <= rates[prev].high && rates[curr].low >= rates[prev].low) st[i - 1] = 1;
      else if(rates[curr].high > rates[prev].high && rates[curr].low < rates[prev].low) st[i - 1] = 2;
      else st[i - 1] = 3;
   }

   if(st[2] == 2 && st[1] == 1 && st[0] == 2)
   {
      if(rates[1].close > rates[1].open)
         AddPattern(PATT_2_1_2_BULL_CONT, PATTERN_CONTINUATION_BULL, 1, rates[1].close, rates[1].time, 88);
      if(rates[1].close < rates[1].open)
         AddPattern(PATT_2_1_2_BEAR_CONT, PATTERN_CONTINUATION_BEAR, 1, rates[1].close, rates[1].time, 88);
   }

   if(st[2] == 3 && st[1] == 1 && st[0] == 2)
   {
      if(rates[3].close < rates[3].open && rates[1].close > rates[1].open)
         AddPattern(PATT_3_1_2_BULL_REV, PATTERN_REVERSAL_BULLISH, 1, rates[1].close, rates[1].time, 92);
      if(rates[3].close > rates[3].open && rates[1].close < rates[1].open)
         AddPattern(PATT_3_1_2_BEAR_REV, PATTERN_REVERSAL_BEARISH, 1, rates[1].close, rates[1].time, 92);
   }
}

void GenerateSignalsFromPatterns()
{
   for(int i = 0; i < g_PatternCount; ++i)
   {
      if(g_ActivePatterns[i].type == PATTERN_REVERSAL_BULLISH || g_ActivePatterns[i].type == PATTERN_REVERSAL_BEARISH)
         g_ActivePatterns[i].generates_warn = true;

      if(g_ActivePatterns[i].type == PATTERN_CONTINUATION_BULL || g_ActivePatterns[i].type == PATTERN_CONTINUATION_BEAR)
         g_ActivePatterns[i].generates_praise = true;
   }
}

bool InitializePatternDetection()
{
   ArrayResize(g_ActivePatterns, MAX_PATTERNS);
   g_PatternCount = 0;
   return true;
}

void DetectAllCandlestickPatterns()
{
   g_PatternCount = 0;

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, _Period, 0, 100, rates);
   if(copied < 20) return;

   DetectSingleCandlePatterns(rates);
   DetectTwoCandlePatterns(rates);
   DetectThreeCandlePatterns(rates);
   DetectTheStratPatterns(rates);
   GenerateSignalsFromPatterns();
}

int GetPatternWarnCount()
{
   int count = 0;
   for(int i = 0; i < g_PatternCount; ++i)
      if(g_ActivePatterns[i].generates_warn) count++;
   return count;
}

int GetPatternPraiseCount()
{
   int count = 0;
   for(int i = 0; i < g_PatternCount; ++i)
      if(g_ActivePatterns[i].generates_praise) count++;
   return count;
}

#endif
