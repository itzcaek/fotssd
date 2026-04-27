# server.py
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

# Сервер будет работать в текущей директории, где лежит этот скрипт
# os.chdir больше не нужен

server = HTTPServer(('localhost', 8001), SimpleHTTPRequestHandler)
print('🚀 Сервер запущен: http://localhost:8001')
print('📂 Рабочая папка:', os.getcwd())
server.serve_forever()