# file-organizer

CLI-інструмент на Node.js для наведення порядку в директорії Downloads: аналізує файли, знаходить дублікати, сортує по категоріях і видаляє застарілі дані. Без зовнішніх залежностей.

## Встановлення

Потрібен **Node.js ≥ 20.12** (використовуються `fs.readdir` з `recursive: true` та `Dirent.parentPath`).

```bash
git clone <url-вашого-репозиторію>
cd file-organizer
node file-organizer.js --help
```

Залежності встановлювати не потрібно (`npm install` нічого не завантажує). Проєкт використовує ES Modules (`"type": "module"`).

## Швидкий старт

```bash
node file-organizer.js scan ~/Downloads
node file-organizer.js duplicates ~/Downloads
node file-organizer.js organize ~/Downloads --output ~/Organized
node file-organizer.js cleanup ~/Downloads --older-than 90
```

Через npm scripts (аргументи передаються після `--`):

```bash
npm run scan -- ~/Downloads
npm run cleanup -- ~/Downloads --older-than 90 --confirm
```

## Команди

### `scan <directory>`
Рекурсивно обходить директорію та виводить: кількість і сумарний розмір файлів; групування за розширенням (топ-5 типів + `(other)`); розподіл за віком (7 днів / 30 днів / старіші за 90); топ-3 найбільших файли; найстаріший файл. Вік визначається за `mtime`.

### `duplicates <directory>`
Обчислює SHA-256 кожного файлу **потоково** (`fs.createReadStream` + `hash.update(chunk)`), групує за хешем і показує лише групи з >1 файлом. Витрачене місце = розмір × (копій − 1).

### `organize <directory> --output <target>`
Копіює файли (оригінали не чіпає) у `Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other` всередині `<target>`.
- файли **< 10 MB** — `fs.copyFile()`;
- файли **≥ 10 MB** — `pipeline(createReadStream, createWriteStream)`;
- якщо файл існує — нове ім'я `file(1).pdf`, `file(2).pdf`, … (нічого не перезаписується);
- якщо `<target>` лежить всередині `<directory>`, уже організовані файли пропускаються.

### `cleanup <directory> --older-than <days> [--confirm]`
Шукає файли, змінені більше ніж `<days>` днів тому.
- без `--confirm` — **dry run**: лише список і підсумок;
- з `--confirm` — показує список і видаляє файли через `fs.unlink()`.

## Аргументи

| Аргумент | Команди | Опис |
|---|---|---|
| `<directory>` | усі | директорія для обробки |
| `-o`, `--output <dir>` | organize | цільова директорія (обов'язково) |
| `--older-than <n>` | cleanup | поріг віку в днях (обов'язково) |
| `--confirm` | cleanup | реальне видалення (за замовчуванням dry run) |
| `-h`, `--help` | усі | довідка |

Аргументи розбираються через `util.parseArgs` над `process.argv.slice(2)`.

## Архітектура

Кожна команда — клас, що наслідує `EventEmitter`. Класи не знають про консоль; весь вивід (прогрес-бар, звіти) робить `file-organizer.js`, підписуючись на події.

| Клас | Події |
|---|---|
| `Scanner` | `scan-start`, `file-found`, `file-error`, `scan-complete` |
| `DuplicateFinder` | `search-start`, `file-processed`, `file-error`, `duplicates-found` |
| `Organizer` | `organize-start`, `folders-created`, `copy-start`, `copy-complete`, `copy-error`, `organize-complete` |
| `Cleanup` | `file-found`, `file-deleted`, `file-error`, `cleanup-complete` |

## Обробка помилок

Усі файлові операції в `try...catch`. `describeError()` дає зрозумілі повідомлення для `ENOENT`, `EACCES`, `EPERM`, `ENOTDIR`, `EISDIR`, `EEXIST`, `ENOSPC`, `EMFILE`, `EBUSY` та інших. Фатальна помилка завершує програму з кодом `1`; помилка на окремому файлі (наприклад, немає доступу) не зупиняє обробку — файл пропускається, а в кінці виводиться список попереджень.

## Структура проєкту

```
file-organizer/
├── package.json
├── .gitignore
├── README.md
├── file-organizer.js   # точка входу: парсинг аргументів, вивід, підписка на події
└── lib/
    ├── scanner.js      # клас Scanner (scan)
    ├── duplicates.js   # клас DuplicateFinder (duplicates, calculateHash)
    ├── organizer.js    # клас Organizer (organize, категорії)
    ├── cleanup.js      # клас Cleanup (cleanup)
    └── utils.js        # formatSize, drawProgressBar, listFiles, обробка помилок
```
