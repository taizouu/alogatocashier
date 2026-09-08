import os
import requests
from datetime import datetime, timedelta

class ShopifyService:
    _access_token = None
    _token_expiry = None

    @classmethod
    def get_token(cls):
        # Si tenemos un token guardado en memoria y aún no expira, lo reutilizamos
        if cls._access_token and cls._token_expiry and datetime.now() < cls._token_expiry:
            return cls._access_token

        store_url = os.getenv('SHOPIFY_STORE_URL')
        
        # Solicitamos un nuevo token a Shopify usando tus credenciales
        url = f"https://{store_url}/admin/oauth/access_token"
        payload = {
            "client_id": os.getenv('SHOPIFY_CLIENT_ID'),
            "client_secret": os.getenv('SHOPIFY_CLIENT_SECRET'),
            "grant_type": "client_credentials"
        }

        response = requests.post(url, json=payload)
        
        if response.status_code == 200:
            data = response.json()
            cls._access_token = data['access_token']
            # El token expira en 86400 segundos (24 horas). Le restamos 60 seg de margen.
            expires_in = data.get('expires_in', 86400) 
            cls._token_expiry = datetime.now() + timedelta(seconds=expires_in - 60)
            return cls._access_token
        else:
            raise Exception(f"Fallo de autenticación con Shopify: {response.text}")

    @classmethod
    def buscar_producto(cls, codigo_barras):
        token = cls.get_token()
        store_url = os.getenv('SHOPIFY_STORE_URL')
        
        # Consultamos la API REST de productos filtrando por el código de barras
        url = f"https://{store_url}/admin/api/2026-07/products.json"
        headers = {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json"
        }
        
        response = requests.get(url, headers=headers, params={"barcode": codigo_barras})
        
        if response.status_code == 200:
            productos = response.json().get('products', [])
            if productos:
                producto = productos[0]
                variante = producto['variants'][0]
                
                return {
                    "id_shopify": producto['id'],
                    "codigo_barras": codigo_barras,
                    "nombre": producto['title'],
                    "precio": float(variante['price']),
                    "stock": variante.get('inventory_quantity', 0)
                }
        return None 