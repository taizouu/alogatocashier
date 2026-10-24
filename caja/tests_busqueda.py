"""
Pruebas del buscador de productos. No necesitan Django ni Shopify:
    python -m unittest caja.tests_busqueda -v
Los productos son ejemplos reales del catálogo de la tienda.
"""
import unittest

from caja.busqueda import buscar, normalizar, preparar, productos_por_tipo


def producto(titulo, variante, proveedor, tipo, etiquetas=(), sku='', codigo=''):
    nombre = titulo if not variante else f"{titulo} - {variante}"
    return {
        'id_shopify': f'gid://shopify/ProductVariant/{abs(hash(nombre))}',
        'titulo': titulo, 'nombre': nombre, 'variante': variante,
        'proveedor': proveedor, 'tipo': tipo, 'etiquetas': list(etiquetas),
        'sku': sku, 'codigo_barras': codigo, 'precio': 1000, 'stock_disponible': 1,
    }


CATALOGO = [
    producto('ACRÍLICO STD 250 ML', 'LIMONADA', 'Krack', 'Acrílicos', ['250 ML', 'Estandar']),
    producto('ACRÍLICO STD 250 ML', 'HELADO DE PIÑA', 'Krack', 'Acrílicos', ['250 ML', 'Estandar']),
    producto('Acrílico STD 750 ML', 'LIMONADA', 'Krack', 'Acrílicos', ['750 ML', 'Estandar']),
    producto('ACRÍLICO FLUOR 250 ML', 'CHALECO AMARILLO', 'Krack', 'Acrílicos', ['250 ML', 'Fluor']),
    producto('KRACK - LATEX PREMIUM 1 LT', 'AZUL METH', 'Krack', 'Latex', ['Estandar'], codigo='0731299199532'),
    producto('KRACK - ESMALTE PREMIUM 4 LT.', 'La victoria', 'Krack', 'Esmalte', ['Estandar'], codigo='0731299197637'),
    producto('Spray Motta Naranja Greda 400 ml – Pintura para graffiti', '', 'Motta', 'Aerosoles',
             ['400 ML', 'Estandar', 'Motta', 'naranjo', 'pintura en aerosol', 'spray graffiti'],
             sku='07_NaranjaGreda_400'),
    producto('Spray Loop 109 Sevilla 400 ml – Pintura para graffiti', '', 'Loop Colors', 'Aerosoles',
             ['400 ML', 'amarillos', 'Loop 400', 'Loop Colors'], sku='LOOP-109'),
    producto('Toro Cromado', '', 'Toro', 'Aerosoles', ['400 ML', 'Cromado'], sku='TN0070'),
]
INDICE = [preparar(p) for p in CATALOGO]


def nombres(consulta, **kwargs):
    return [p['nombre'] for p in buscar(INDICE, consulta, **kwargs)]


class BuscadorTests(unittest.TestCase):

    def test_marca_que_no_esta_en_el_titulo(self):
        # El caso que motivó el cambio: "ACRÍLICO STD 250 ML" es Krack sin decirlo
        resultado = nombres('krack')
        self.assertEqual(len(resultado), 6)
        self.assertIn('ACRÍLICO STD 250 ML - LIMONADA', resultado)

    def test_color_de_la_variante(self):
        self.assertEqual(nombres('limonada'), [
            'ACRÍLICO STD 250 ML - LIMONADA',
            'Acrílico STD 750 ML - LIMONADA',
        ])

    def test_palabras_en_campos_distintos(self):
        # "krack" está en la marca, "limonada" en la variante, "750" en el título
        self.assertEqual(nombres('krack limonada 750'), ['Acrílico STD 750 ML - LIMONADA'])

    def test_sin_tildes_ni_mayusculas(self):
        self.assertEqual(nombres('acrilico fluor'), ['ACRÍLICO FLUOR 250 ML - CHALECO AMARILLO'])
        self.assertEqual(nombres('HELADO DE PINA'), ['ACRÍLICO STD 250 ML - HELADO DE PIÑA'])

    def test_comienzo_de_palabra(self):
        self.assertEqual(len(nombres('acri')), 4)

    def test_por_tipo_de_producto(self):
        self.assertEqual(len(nombres('aerosoles')), 3)
        self.assertEqual(nombres('esmalte'), ['KRACK - ESMALTE PREMIUM 4 LT. - La victoria'])

    def test_por_etiqueta(self):
        self.assertEqual(nombres('cromado'), ['Toro Cromado'])

    def test_por_sku_y_codigo_de_barras(self):
        self.assertEqual(nombres('loop-109'), ['Spray Loop 109 Sevilla 400 ml – Pintura para graffiti'])
        self.assertEqual(nombres('0731299199532'), ['KRACK - LATEX PREMIUM 1 LT - AZUL METH'])

    def test_todas_las_palabras_deben_coincidir(self):
        self.assertEqual(nombres('krack aerosoles'), [])

    def test_palabra_corta_no_coincide_dentro_de_otra(self):
        # "ro" está dentro de "Toro" y "naranjo", pero no al inicio de ninguna palabra
        self.assertEqual(nombres('ro'), [])

    def test_marca_exacta_antes_que_coincidencia_parcial(self):
        # "toro" es la marca de Toro Cromado; debe salir primero
        self.assertEqual(nombres('toro')[0], 'Toro Cromado')

    def test_limite_y_consulta_vacia(self):
        self.assertEqual(len(nombres('krack', limite=2)), 2)
        self.assertEqual(nombres('   '), [])
        self.assertEqual(nombres('xyz inexistente'), [])

    def test_normalizar(self):
        self.assertEqual(normalizar('  ACRÍLICO-Piña  '), 'acrilico pina')
        self.assertEqual(normalizar(None), '')



class ProductosPorTipoTests(unittest.TestCase):

    ITEMS = [
        producto('Skinny Loop', '', 'Alogato Graffiti Store', 'Caps', ['Skinny']),
        producto('Astro Fat', '', 'Alogato Graffiti Store', 'Caps', ['Fat']),
        producto('Puntas de Repuesto Uni POSCA PCR-5', '', 'POSCA', 'Repuestos y Puntas'),
        producto('OTR 070 Hard To Buff (Punta Dedo)', '', 'OTR', 'Markers'),
    ]

    def test_filtra_por_tipo_y_ordena_por_nombre(self):
        self.assertEqual([p['nombre'] for p in productos_por_tipo(self.ITEMS, ['Caps'])],
                         ['Astro Fat', 'Skinny Loop'])

    def test_tipo_sin_importar_mayusculas_ni_tildes(self):
        self.assertEqual(len(productos_por_tipo(self.ITEMS, ['repuestos y puntas'])), 1)

    def test_un_marcador_con_punta_en_el_nombre_no_es_repuesto(self):
        nombres = [p['nombre'] for p in productos_por_tipo(self.ITEMS, ['Repuestos y Puntas'])]
        self.assertNotIn('OTR 070 Hard To Buff (Punta Dedo)', nombres)

    def test_varios_tipos(self):
        self.assertEqual(len(productos_por_tipo(self.ITEMS, ['Caps', 'Markers'])), 3)

if __name__ == '__main__':
    unittest.main()
