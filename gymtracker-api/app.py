import os
import datetime
from flask import Flask, jsonify, g, request, make_response
from flask_cors import CORS
from flask_jwt_extended import JWTManager, verify_jwt_in_request, get_jwt_identity
from flask_bcrypt import Bcrypt
from flask.json.provider import DefaultJSONProvider

from config import Config
import db as database

_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,Accept",
    "Access-Control-Max-Age": "86400",
}


class ISOJSONProvider(DefaultJSONProvider):
    """Serializa date/datetime como ISO 8601 (yyyy-MM-dd) em vez do formato HTTP do Flask 3."""
    def default(self, o):
        if isinstance(o, datetime.datetime):
            return o.isoformat()
        if isinstance(o, datetime.date):
            return o.isoformat()
        return super().default(o)

bcrypt = Bcrypt()
jwt = JWTManager()


def create_app():
    app = Flask(__name__)
    app.json_provider_class = ISOJSONProvider
    app.json = ISOJSONProvider(app)
    app.config.from_object(Config)

    CORS(app)
    bcrypt.init_app(app)
    jwt.init_app(app)

    database.init_db_config(app)

    # init_db só roda localmente (defina INIT_DB=true no .env local)
    if os.getenv("INIT_DB") == "true":
        with app.app_context():
            try:
                database.init_db()
            except Exception as e:
                print(f"[DB] init_db error: {e}")

    @app.before_request
    def _handle_options():
        """Responde imediatamente a qualquer OPTIONS preflight com 200 + CORS headers."""
        if request.method == "OPTIONS":
            resp = make_response("", 200)
            for k, v in _CORS_HEADERS.items():
                resp.headers[k] = v
            return resp

    @app.before_request
    def _set_db_user():
        """Extrai user_id do JWT e armazena em g para injeção RLS no db()."""
        try:
            verify_jwt_in_request(optional=True)
            uid = get_jwt_identity()
            if uid:
                g.user_id = int(uid)
        except Exception:
            pass

    from modules.auth import bp as auth_bp
    from modules.cadastros import bp as cadastros_bp
    from modules.treino import bp as treino_bp
    from modules.resultados import bp as resultados_bp
    from modules.analise import bp as analise_bp

    app.register_blueprint(auth_bp, url_prefix="/auth")
    app.register_blueprint(cadastros_bp, url_prefix="/cadastros")
    app.register_blueprint(treino_bp, url_prefix="/treino")
    app.register_blueprint(resultados_bp, url_prefix="/resultados")
    app.register_blueprint(analise_bp, url_prefix="/analise")

    @app.after_request
    def _add_cors_headers(resp):
        for k, v in _CORS_HEADERS.items():
            resp.headers.setdefault(k, v)
        return resp

    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return jsonify({"error": "Token inválido ou expirado."}), 401

    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        return jsonify({"error": "Token inválido ou expirado."}), 401

    @jwt.unauthorized_loader
    def missing_token_callback(error):
        return jsonify({"error": "Token inválido ou expirado."}), 401

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    return app
