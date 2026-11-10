#ifndef INDICATORS_MQH
#define INDICATORS_MQH

int MA_Periods[8] = {7, 14, 21, 50, 140, 230, 500, 1400};
int MA_Handles[8];
double MA_Current[8];
double MA_Previous[8];

int h_stoch = INVALID_HANDLE;
double Stoch_K_Current = 50.0;
double Stoch_K_Previous = 50.0;
double Stoch_D_Current = 50.0;

int h_atr = INVALID_HANDLE;
double Current_ATR = 0.0;

int h_adx = INVALID_HANDLE;
double Current_ADX = 0.0;

bool InitializeIndicators()
{
   ArrayInitialize(MA_Handles, INVALID_HANDLE);
   ArrayInitialize(MA_Current, 0.0);
   ArrayInitialize(MA_Previous, 0.0);

   for(int i = 0; i < 8; ++i)
   {
      MA_Handles[i] = iMA(_Symbol, PERIOD_CURRENT, MA_Periods[i], 0, MODE_EMA, PRICE_CLOSE);
      if(MA_Handles[i] == INVALID_HANDLE)
         return false;
   }

   h_stoch = iStochastic(_Symbol, PERIOD_CURRENT, 14, 3, 3, MODE_SMA, STO_LOWHIGH);
   h_atr   = iATR(_Symbol, PERIOD_CURRENT, 14);
   h_adx   = iADX(_Symbol, PERIOD_CURRENT, 14);

   if(h_stoch == INVALID_HANDLE || h_atr == INVALID_HANDLE || h_adx == INVALID_HANDLE)
      return false;

   return true;
}

void UpdateIndicators()
{
   double b2[2];

   for(int i = 0; i < 8; ++i)
   {
      if(MA_Handles[i] != INVALID_HANDLE && CopyBuffer(MA_Handles[i], 0, 0, 2, b2) > 1)
      {
         MA_Current[i] = b2[0];
         MA_Previous[i] = b2[1];
      }
   }

   if(h_stoch != INVALID_HANDLE && CopyBuffer(h_stoch, 0, 0, 2, b2) > 1)
   {
      Stoch_K_Current = b2[0];
      Stoch_K_Previous = b2[1];
   }

   if(h_stoch != INVALID_HANDLE && CopyBuffer(h_stoch, 1, 0, 1, b2) > 0)
      Stoch_D_Current = b2[0];

   if(h_atr != INVALID_HANDLE && CopyBuffer(h_atr, 0, 0, 1, b2) > 0)
      Current_ATR = b2[0];

   if(h_adx != INVALID_HANDLE && CopyBuffer(h_adx, 0, 0, 1, b2) > 0)
      Current_ADX = b2[0];
}

bool IsBullBias()
{
   return (MA_Current[0] > MA_Current[3] && MA_Current[3] > MA_Current[4]);
}

bool IsBearBias()
{
   return (MA_Current[0] < MA_Current[3] && MA_Current[3] < MA_Current[4]);
}

int BiasDirection()
{
   if(IsBullBias()) return 1;
   if(IsBearBias()) return -1;
   return 0;
}

void ReleaseIndicators()
{
   for(int i = 0; i < 8; ++i)
   {
      if(MA_Handles[i] != INVALID_HANDLE)
         IndicatorRelease(MA_Handles[i]);
      MA_Handles[i] = INVALID_HANDLE;
   }

   if(h_stoch != INVALID_HANDLE) IndicatorRelease(h_stoch);
   if(h_atr != INVALID_HANDLE) IndicatorRelease(h_atr);
   if(h_adx != INVALID_HANDLE) IndicatorRelease(h_adx);

   h_stoch = INVALID_HANDLE;
   h_atr = INVALID_HANDLE;
   h_adx = INVALID_HANDLE;
}

#endif
