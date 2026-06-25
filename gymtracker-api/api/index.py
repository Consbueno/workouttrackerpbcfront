import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_CORS_HEADERS = [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"),
    ("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept"),
    ("Access-Control-Max-Age", "86400"),
    ("Content-Type", "text/plain"),
]

# Tenta inicializar o Flask — captura erros de startup para diagnóstico
_flask_app = None
_startup_error = None
try:
    from app import create_app
    _flask_app = create_app()
except Exception:
    import traceback
    _startup_error = traceback.format_exc()
    print(f"[STARTUP ERROR]\n{_startup_error}", flush=True)


def app(environ, start_response):
    # OPTIONS respondido no nível WSGI — antes do Flask, sempre retorna 200
    if environ.get("REQUEST_METHOD") == "OPTIONS":
        start_response("200 OK", _CORS_HEADERS)
        return [b""]

    # Se houve erro de startup, retorna 500 com detalhes para diagnóstico
    if _flask_app is None:
        body = f"[STARTUP ERROR]\n{_startup_error}".encode()
        start_response("500 Internal Server Error", [
            ("Content-Type", "text/plain"),
            ("Access-Control-Allow-Origin", "*"),
        ])
        return [body]

    return _flask_app(environ, start_response)
