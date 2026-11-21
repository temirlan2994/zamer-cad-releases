#!/usr/bin/env python3
"""Полная проверка IFC от Kepler Plan в IfcOpenShell (для разработчика, не CI).

    pip install ifcopenshell pytest
    python3 scripts/check-ifc.py дом.ifc

Проверяет схему IFC4 и правила EXPRESS (WHERE), строит геометрию всех
элементов (с вычитанием проёмов из стен) и печатает состав модели.
Код выхода 1 — есть нарушения или элементы без геометрии.
"""
import sys

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.validate


def main(path):
    model = ifcopenshell.open(path)
    print('схема', model.schema)
    for t in ['IfcBuildingStorey', 'IfcWall', 'IfcDoor', 'IfcWindow', 'IfcOpeningElement', 'IfcSpace', 'IfcColumn']:
        print(f'  {t}: {len(model.by_type(t))}')
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=True)
    for st in logger.statements[:20]:
        print('  нарушение:', st)
    settings = ifcopenshell.geom.settings()
    failed = 0
    for el in model.by_type('IfcProduct'):
        if el.Representation is None:
            continue
        try:
            ifcopenshell.geom.create_shape(settings, el)
        except Exception as error:  # noqa: BLE001 — печатаем и считаем
            failed += 1
            print('  нет геометрии:', el.is_a(), el.GlobalId, error)
    print(f'нарушений схемы: {len(logger.statements)}, без геометрии: {failed}')
    return 1 if logger.statements or failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
