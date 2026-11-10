#ifndef __DATA_ADAPTER_MQH__
#define __DATA_ADAPTER_MQH__

#include "SMarketSnapshot.mqh"

class CDataAdapter
{
private:
   int    m_hATR;
   int    m_hEMA50;
   int    m_hEMA200;
   int    m_hRSI;
   string m_symbol;
   ENUM_TIMEFRAMES m_tf;

public:
   CDataAdapter() : m_hATR(INVALID_HANDLE),
                    m_hEMA50(INVALID_HANDLE),
                    m_hEMA200(INVALID_HANDLE),
                    m_hRSI(INVALID_HANDLE) {}

   bool Init(const string symbol, const ENUM_TIMEFRAMES tf)
   {
      m_symbol  = symbol;
      m_tf      = tf;

      m_hATR    = iATR(symbol, tf, 14);
      m_hEMA50  = iMA(symbol, tf, 50,  0, MODE_EMA, PRICE_CLOSE);
      m_hEMA200 = iMA(symbol, tf, 200, 0, MODE_EMA, PRICE_CLOSE);
      m_hRSI    = iRSI(symbol, tf, 14, PRICE_CLOSE);

      if(m_hATR    == INVALID_HANDLE || m_hEMA50 == INVALID_HANDLE ||
         m_hEMA200 == INVALID_HANDLE || m_hRSI   == INVALID_HANDLE)
      {
         PrintFormat("[DataAdapter][ERROR] Indicator init failed symbol=%s", symbol);
         return false;
      }
      return true;
   }

   void Deinit()
   {
      if(m_hATR    != INVALID_HANDLE) { IndicatorRelease(m_hATR);    m_hATR    = INVALID_HANDLE; }
      if(m_hEMA50  != INVALID_HANDLE) { IndicatorRelease(m_hEMA50);  m_hEMA50  = INVALID_HANDLE; }
      if(m_hEMA200 != INVALID_HANDLE) { IndicatorRelease(m_hEMA200); m_hEMA200 = INVALID_HANDLE; }
      if(m_hRSI    != INVALID_HANDLE) { IndicatorRelease(m_hRSI);    m_hRSI    = INVALID_HANDLE; }
   }

   bool BuildSnapshot(SMarketSnapshot &snap)
   {
      snap.symbol   = m_symbol;
      snap.tf       = m_tf;
      snap.ts_utc   = TimeGMT();
      snap.is_valid = false;

      snap.bid = SymbolInfoDouble(m_symbol, SYMBOL_BID);
      snap.ask = SymbolInfoDouble(m_symbol, SYMBOL_ASK);
      if(snap.bid <= 0.0 || snap.ask <= 0.0) return false;

      double pt = SymbolInfoDouble(m_symbol, SYMBOL_POINT);
      if(pt <= 0.0) return false;
      snap.spread_points = (snap.ask - snap.bid) / pt;

      double atrBuf[1], ema50Buf[1], ema200Buf[1], rsiBuf[1];
      if(CopyBuffer(m_hATR,    0, 1, 1, atrBuf)   != 1) return false;
      if(CopyBuffer(m_hEMA50,  0, 1, 1, ema50Buf)  != 1) return false;
      if(CopyBuffer(m_hEMA200, 0, 1, 1, ema200Buf) != 1) return false;
      if(CopyBuffer(m_hRSI,    0, 1, 1, rsiBuf)    != 1) return false;

      snap.atr14  = atrBuf[0];
      snap.ema50  = ema50Buf[0];
      snap.ema200 = ema200Buf[0];
      snap.rsi14  = rsiBuf[0];

      MqlRates rates[];
      ArraySetAsSeries(rates, true);
      if(CopyRates(m_symbol, m_tf, 1, 3, rates) != 3) return false;

      snap.bar_time = rates[0].time;

      for(int i = 0; i < 3; i++)
      {
         snap.close[i]  = rates[i].close;
         snap.high[i]   = rates[i].high;
         snap.low[i]    = rates[i].low;
         snap.volume[i] = rates[i].tick_volume;
      }

      snap.is_valid = true;
      return true;
   }
};

#endif // __DATA_ADAPTER_MQH__
