"""Semantic selector regression tests, independent of the HA runtime."""
import json
from pathlib import Path
import sys
import types
import unittest
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.config import entity_matches, setup_selector_config, SOURCE_FIELDS, ROOM_FIELDS
CASES=json.loads(Path(__file__).with_name('entity_selector_cases.json').read_text())

class SelectorTests(unittest.TestCase):
    def test_semantic_types(self):
        for case in CASES:
            state=types.SimpleNamespace(**{key:case[key] for key in ('entity_id','state','attributes')})
            for kind in ('temperature','power','price','target','activity'):
                with self.subTest(entity=state.entity_id,kind=kind):
                    self.assertEqual(entity_matches(state,{'kind':kind}),kind in case['matches'])

    def test_native_setup_excludes_unsuitable_sensors(self):
        states=[types.SimpleNamespace(**{key:c[key] for key in ('entity_id','state','attributes')}) for c in CASES if c['entity_id'].startswith('sensor.')]
        hass=types.SimpleNamespace(states=types.SimpleNamespace(async_all=lambda domain: states))
        for key,kind in [('outdoor_entity','temperature'),('price_entity','price')]:
            config=setup_selector_config(hass,key)
            self.assertEqual(config['filter']['domain'],'sensor')
            self.assertEqual(config['exclude_entities'],[s.entity_id for s in states if not entity_matches(s,{'kind':kind})])

    def test_measurement_cannot_be_activity_unless_explicit_attribute_selected(self):
        state=types.SimpleNamespace(entity_id='sensor.room',state='20',attributes={'device_class':'temperature','unit_of_measurement':'°C','valve':'open'})
        self.assertFalse(entity_matches(state,{'kind':'activity'}))
        self.assertTrue(entity_matches(state,{'kind':'activity'},{'activity_attribute':'valve'}))

    def test_sensor_fields_have_semantic_rules(self):
        for field in SOURCE_FIELDS+ROOM_FIELDS:
            if 'sensor' in field[2].split(','):
                self.assertIsInstance(field[3],dict,field[0])
