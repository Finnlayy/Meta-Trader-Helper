#ifndef __DYNAMICTP_MQH__
#define __DYNAMICTP_MQH__

// Dynamic TakeProfit sizing helpers

double CalculateTPByATR(int periods, double multiplier)
{
   double atr = iATR(_Symbol, PERIOD_M5, periods);
   double tp = atr * multiplier;
   return tp;
}

void ExampleTPList()
{
   for(int m=1;m<=5;m++)
      PrintFormat("TP for multiplier %d = %f", m, CalculateTPByATR(14, m));
}

#endif // __DYNAMICTP_MQH__
