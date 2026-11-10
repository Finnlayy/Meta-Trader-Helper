#ifndef NN_FEATURES_MQH
#define NN_FEATURES_MQH

double NN_Clamp(const double x, const double lo, const double hi)
{
   return MathMax(lo, MathMin(hi, x));
}

int BuildNNFeatures(double &feat[])
{
   ArrayResize(feat, 0);

   double close0 = iClose(_Symbol, PERIOD_CURRENT, 0);
   if(close0 <= 0.0)
      return 0;

   // MA spread and slopes.
   ArrayResize(feat, 12);
   feat[0] = (MA_Current[0] - MA_Current[1]) / _Point;
   feat[1] = (MA_Current[1] - MA_Current[2]) / _Point;
   feat[2] = (MA_Current[2] - MA_Current[3]) / _Point;
   feat[3] = (MA_Current[3] - MA_Current[4]) / _Point;
   feat[4] = (MA_Current[0] - MA_Previous[0]) / _Point;
   feat[5] = (MA_Current[1] - MA_Previous[1]) / _Point;

   // Oscillator/volatility/trend features.
   feat[6] = Stoch_K_Current;
   feat[7] = Stoch_D_Current;
   feat[8] = Current_ADX;
   feat[9] = (Current_ATR > 0.0) ? (Current_ATR / close0) * 10000.0 : 0.0;

   // Fib distances.
   feat[10] = (close0 - MFIB_Level_382) / _Point;
   feat[11] = (close0 - MFIB_Level_618) / _Point;

   return ArraySize(feat);
}

#endif
