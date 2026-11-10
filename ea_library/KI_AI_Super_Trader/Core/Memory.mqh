#ifndef __MEMORY_MQH__
#define __MEMORY_MQH__

struct PersistStats
{
   int wins[3];
   int losses[3];
};

PersistStats pstats;

void SyncMemoryFromStats()
{
   for(int i=0; i<3; i++)
   {
      pstats.wins[i]   = stats[i].wins;
      pstats.losses[i] = stats[i].losses;
   }
}

void SyncStatsFromMemory()
{
   for(int i=0; i<3; i++)
   {
      stats[i].wins   = pstats.wins[i];
      stats[i].losses = pstats.losses[i];
   }

   UpdateScores();
}

void SaveStats()
{
   SyncMemoryFromStats();
   int file = FileOpen("stats.dat", FILE_WRITE|FILE_BIN);
   if(file==INVALID_HANDLE) return;
   FileWriteStruct(file, pstats);
   FileClose(file);
}

void LoadMemory()
{
   int file = FileOpen("stats.dat", FILE_READ|FILE_BIN);
   if(file!=INVALID_HANDLE)
   {
      FileReadStruct(file, pstats);
      FileClose(file);
   }

   SyncStatsFromMemory();
}

#endif // __MEMORY_MQH__
