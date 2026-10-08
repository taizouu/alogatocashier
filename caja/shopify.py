import os
import threading
import logging
import shopify
import requests
from datetime import datetime, timedelta
from django.conf import settings

logger = logging.getLogger(__name__)


class ShopifyTokenManager:
    """
    Gestiona el token de acceso temporal de Shopify (Client Credentials)
    de forma thread-safe usando un Lock para evitar condiciones de carrera
    cuando múltiples requests concurrentes necesitan renovar el token.
    """
    def __init__(self):
        self._access_token = None
        self._token_expiry = None
        self._lock = threading.Lock()

    def get_token(self):
        # Lectura rápida sin lock (el token válido se puede leer concurrentemente)
        if self._access_token and self._token_expiry and datetime.now() < self._token_expiry:
            return self._access_token

        # Solo un hilo a la vez puede renovar el token
        with self._lock:
            # Double-check: otro hilo pudo haber renovado mientras esperábamos el lock
            if self._access_token and self._token_expiry and datetime.now() < self._token_expiry:
                return self._access_token

            return self._refresh_token()

    def _refresh_token(self):
        """Solicita un nuevo token a Shopify. Debe llamarse dentro del lock."""
        store_url = settings.SHOPIFY_STORE_URL
        url = f"https://{store_url}/admin/oauth/access_token"

        payload = {
            "client_id": settings.SHOPIFY_CLIENT_ID,
            "client_secret": settings.SHOPIFY_CLIENT_SECRET,
            "grant_type": "client_credentials"
        }

        response = requests.post(url, json=payload, timeout=15)

        if response.status_code == 200:
            data = response.json()
            self._access_token = data['access_token']
            # Shopify entrega un token válido por 86400 segundos (24 horas).
            # Restamos 60 segundos de margen para prevenir desfases.
            expires_in = data.get('expires_in', 86400)
            self._token_expiry = datetime.now() + timedelta(seconds=expires_in - 60)
            logger.info("Token de Shopify renovado exitosamente.")
            return self._access_token
        else:
            logger.error("Falla de autenticación con Shopify: %s", response.text)
            raise Exception(f"Falla de autenticación con Shopify: {response.text}")

    def invalidate(self):
        """Fuerza la renovación del token en la siguiente llamada."""
        with self._lock:
            self._access_token = None
            self._token_expiry = None


# Instancia única del gestor de tokens (singleton a nivel de módulo)
token_manager = ShopifyTokenManager()


def obtener_token_temporal():
    """Función de conveniencia que delega al token manager thread-safe."""
    return token_manager.get_token()


def activar_sesion_shopify():
    """Activa una sesión de la librería oficial de Shopify usando el token temporal."""
    token = obtener_token_temporal()
    session = shopify.Session(
        settings.SHOPIFY_STORE_URL,
        settings.SHOPIFY_API_VERSION,
        token
    )
    shopify.ShopifyResource.activate_session(session)
