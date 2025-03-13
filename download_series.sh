#!/bin/sh

# Перевіряємо, чи передано параметр
if [ $# -ne 1 ]; then
    echo "Використання: $0 <шлях_до_json_файлу>"
    exit 1
fi

# Призначаємо параметр як вхідний файл
input_file="$1"


# Функція для створення директорії якщо її немає
create_dir() {
    local path="$1"
    local dir=$(dirname "$path")
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
    fi
}

# Перевіряємо чи файл існує
if [ ! -f "$input_file" ]; then
    echo "Помилка: файл $input_file не знайдено"
    exit 1
fi

# Проходимо по кожному об'єкту в масиві
jq -c '.[]' "$input_file" | while read -r item; do
  {
     # Отримуємо path та link
        path=$(echo "$item" | jq -r '.path')
        link=$(echo "$item" | jq -r '.link')

        # echo "Завантаження: $path"

        # Створюємо директорію
        create_dir "$path"

        link="https://rezka.fayvlad.workers.dev/?target=$link"
        # Завантажуємо файл
        wget -q -O "$path" "$link" || {
            echo "🚫Помилка при завантаженні $path"
            continue
        }

        echo "✅ Успішно завантажено: $path"
  } || {
    echo "⚠️ Виникла помилка при обробці елемента: $item"
    continue
  }

done

echo "🚀 Завантаження завершено!"
