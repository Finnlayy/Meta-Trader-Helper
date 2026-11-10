#ifndef __SESSION_FILTER_MQH__
#define __SESSION_FILTER_MQH__

class CSessionFilter
{
private:
   int  m_londonOpenHour;
   int  m_londonCloseHour;
   int  m_nyOpenHour;
   int  m_nyCloseHour;
   bool m_filterWeekend;
   bool m_enabled;

   bool IsWeekend(const MqlDateTime &dt) const
   {
      return (dt.day_of_week == 0 || dt.day_of_week == 6);
   }

   bool IsInSession(int hour, int openHour, int closeHour) const
   {
      if(openHour < closeHour)
         return (hour >= openHour && hour < closeHour);
      return (hour >= openHour || hour < closeHour);
   }

public:
   CSessionFilter() :
      m_londonOpenHour(7),  m_londonCloseHour(17),
      m_nyOpenHour(13),     m_nyCloseHour(22),
      m_filterWeekend(true), m_enabled(true) {}

   void Init(int londonOpen, int londonClose, int nyOpen, int nyClose,
             bool filterWeekend, bool enabled)
   {
      m_londonOpenHour  = londonOpen;
      m_londonCloseHour = londonClose;
      m_nyOpenHour      = nyOpen;
      m_nyCloseHour     = nyClose;
      m_filterWeekend   = filterWeekend;
      m_enabled         = enabled;
   }

   bool IsTradeAllowed() const
   {
      if(!m_enabled) return true;

      MqlDateTime dt;
      TimeToStruct(TimeGMT(), dt);

      if(m_filterWeekend && IsWeekend(dt)) return false;

      int hour = dt.hour;
      bool inLondon = IsInSession(hour, m_londonOpenHour, m_londonCloseHour);
      bool inNY     = IsInSession(hour, m_nyOpenHour, m_nyCloseHour);

      return (inLondon || inNY);
   }

   string GetActiveSession() const
   {
      MqlDateTime dt;
      TimeToStruct(TimeGMT(), dt);
      int hour = dt.hour;

      bool inLondon = IsInSession(hour, m_londonOpenHour, m_londonCloseHour);
      bool inNY     = IsInSession(hour, m_nyOpenHour, m_nyCloseHour);

      if(inLondon && inNY) return "LONDON+NY";
      if(inLondon)         return "LONDON";
      if(inNY)             return "NY";
      return "OFF";
   }
};

#endif // __SESSION_FILTER_MQH__
