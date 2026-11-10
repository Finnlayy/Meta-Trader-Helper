//+------------------------------------------------------------------+
//|                                        NeuroPro_Converter.mq5    |
//|    Скрипт для автоматической адаптации кода NeuroPro под MQL5    |
//+------------------------------------------------------------------+
#property strict
#property script_show_inputs

//--- Входные параметры
input string InpSubFolder   = "NeuroPro\\";                    // Папка в MQL5\Files
input string InpFileNameIn  = "NeuroPro.txt";                  // Имя исходного файл из NeuroPro
input string InpFileNameOut = "NeuroPro готово.txt";           // Результат для вставки в советник
input int    InpMaxTokenLen = 256;                             // Максимальная длина токена (безопасность)
input int    InpMaxFileSize = 10485760;                        // Максимальный размер входного файла (10 MB)

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void OnStart()
  {
   string input_path  = InpSubFolder + InpFileNameIn;
   string output_path = InpSubFolder + InpFileNameOut;

// 1. РАБОТА С ФАЙЛОМ
// Открываем как бинарный (FILE_BIN), чтобы буфер обмена Windows не портил кодировку
   int hIn = FileOpen(input_path, FILE_READ|FILE_BIN);
   if(hIn == INVALID_HANDLE)
     {
      Alert("Файл не найден! Проверьте путь в MQL5/Files");
      return;
     }

   uchar buffer[];
   FileReadArray(hIn, buffer);
   // Защита от слишком больших файлов
   if(ArraySize(buffer) > InpMaxFileSize)
     {
      FileClose(hIn);
      Alert("Входной файл слишком большой — отмена (проверьте InpMaxFileSize)");
      return;
     }
   FileClose(hIn);

// 2. ДЕКОДИРОВАНИЕ КИРИЛЛИЦЫ
// Принудительно интерпретируем байты как Windows-1251 (ANSI).
// Это лечит "кракозябры" типа Ñèíäðîì, превращая их в читаемую логику.
   string text = CharArrayToString(buffer, 0, WHOLE_ARRAY, 1251);

// 3. ПРЕДВАРИТЕЛЬНАЯ ПРАВКА СТРУКТУРЫ
// Исправляем то, что NeuroPro пишет по-своему
   StringReplace(text, "___", "[");   // Превращаем BAR___1__ в BAR[1]
   StringReplace(text, "__", "]");
   StringReplace(text, "--", "- -");  // Устраняем ошибку декремента (два минуса подряд)

   string lines[];
   StringSplit(text, '\n', lines); // Разбиваем текст на массив строк

// Файл для записи готового кода
   int hOut = FileOpen(output_path, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(hOut == INVALID_HANDLE)
     {
      Alert("Не удалось открыть файл вывода: " + output_path);
      return;
     }

   for(int i=0; i<ArraySize(lines); i++)
     {
      string line = lines[i];
      StringTrimLeft(line);
      StringTrimRight(line);

      // Отсеиваем информационные строки: в расчетной формуле всегда есть "="
      if(StringLen(line) < 3 || StringFind(line, "=") < 0)
         continue;
      // Пропускаем блок определений функций (A)=
      if(StringFind(line, "(A)=") >= 0)
         continue;

      int equalPos = StringFind(line, "=");
      int bracketPos = StringFind(line, "(");

      // А) ОБРАБОТКА ФУНКЦИЙ (Сигмоиды)
      // Если между "=" и "(" сидит русский текст — это функция активации
      if(bracketPos > equalPos && equalPos >= 0)
        {
         string funcPart = StringSubstr(line, equalPos + 1, bracketPos - (equalPos + 1));
         if(IsRussian(funcPart))
           {
            // Меняем на универсальное Sigmoid + номер функции (Si1, Si2...)
            line = StringSubstr(line, 0, equalPos + 1) + "Sigmoid" + OnlyDigits(funcPart) + StringSubstr(line, bracketPos);
           }
        }

      // Б) ОБРАБОТКА ЛЕВОЙ ЧАСТИ (Результат вычисления)
      string leftPart = StringSubstr(line, 0, equalPos);
      if(IsRussian(leftPart))
        {
         // Если слева кириллица (Синдром) — объявляем новую переменную double Syndrome...
         line = "double Syndrome" + OnlyDigits(leftPart) + StringSubstr(line, equalPos);
        }
      // ВНИМАНИЕ: Если слева латиница (BAR, IN, OUT, GOVNO) — скрипт её не трогает!

      // В) ПРАВАЯ ЧАСТЬ (Аргументы формулы)
      // Разбираем формулу посимвольно, чтобы заменить только русские слова
      line = FixRightPart(line);

      // Г) ФИНАЛЬНЫЙ СИНТАКСИС
      FixEndings(line); // Считаем скобки и ставим ";"

      FileWriteString(hOut, line + "\r\n");
     }

   FileClose(hOut);
   Print("Конвертация завершена! Латиница (входы/выходы) сохранена как в оригинале.");
  }

//--- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

// Определяет кириллицу по коду байта. Всё, что > 127 в ANSI 1251 — это наши спецсимволы.
bool IsRussian(string t)
  {
   for(int i=0; i<StringLen(t); i++)
      if(StringGetCharacter(t, i) > 127)
         return true;
   return false;
  }

// Извлекает из "Синдром1_2" только "1_2", чтобы сохранить индекс переменной
string OnlyDigits(string t)
  {
   string res = "";
   for(int i=0; i<StringLen(t); i++)
     {
      ushort c = StringGetCharacter(t, i);
      if((c >= '0' && c <= '9') || c == '_')
         res += CharToString((uchar)c);
     }
   return res;
  }

// Интеллектуальный разбор правой части формулы
string FixRightPart(string line)
  {
   int eq = StringFind(line, "=");
   if(eq < 0)
      return line;
   string left = StringSubstr(line, 0, eq+1);
   string right = StringSubstr(line, eq+1);
   string word = "", newRight = "";

   for(int i=0; i<=StringLen(right); i++)
     {
      ushort c = (i < StringLen(right)) ? StringGetCharacter(right, i) : 0;

      // Собираем непрерывный блок символов (токен)
      if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c > 127 || (c >= '0' && c <= '9' && word != "") || (c == '_' && word != ""))
        {
         word += CharToString((uchar)c);
         // Защита: ограничиваем длину токена
         if(StringLen(word) > InpMaxTokenLen)
           word = StringSubstr(word, 0, InpMaxTokenLen);
        }
      else
        {
         if(word != "")
           {
            // Если в токене есть русские буквы — трансформируем его
            if(IsRussian(word))
              {
              bool truncated = (StringLen(word) >= InpMaxTokenLen);
              if(StringFind(word, "игм") >= 0)
                newRight += "Sigmoid" + OnlyDigits(word);
              else
                newRight += "Syndrome" + OnlyDigits(word);
              if(truncated)
                newRight += "_TRUNC";
              }
            else
              {
               // ЛАТИНИЦА (BAR, IN и т.д.) — возвращаем без изменений
               newRight += word;
              }
            word = "";
           }
         if(c > 0)
            newRight += CharToString((uchar)c);
        }
     }
   return left + newRight;
  }

// Исправляет ошибки вербализатора NeuroPro в концах строк
void FixEndings(string &line)
  {
   int open = 0, close = 0;
   for(int i=0; i<StringLen(line); i++)
     {
      if(line[i] == '(')
         open++;
      if(line[i] == ')')
         close++;
     }
// Если закрывающих скобок больше, чем открывающих — отрезаем лишнюю с конца
   if(close > open && StringGetCharacter(line, StringLen(line)-1) == ')')
      line = StringSubstr(line, 0, StringLen(line)-1);

// Ставим точку с запятой, если её нет (обязательно для MQL5)
   if(StringGetCharacter(line, StringLen(line)-1) != ';')
      line += ";";
  }
//+------------------------------------------------------------------+
