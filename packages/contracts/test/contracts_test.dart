import 'dart:convert';
import 'dart:io';

import 'package:helpy_contracts/helpy_contracts.dart';
import 'package:test/test.dart';

void main() {
  test('Dart accepts exactly the shared health fixtures', () {
    final fixtures = jsonDecode(
      File('fixtures/health.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    for (final value in fixtures['valid'] as List<dynamic>) {
      expect(HealthResponse.fromJson(value).toJson(), value);
    }
    for (final value in fixtures['invalid'] as List<dynamic>) {
      expect(() => HealthResponse.fromJson(value), throwsFormatException);
    }
  });

  test('Dart reads the same complete catalog as TypeScript', () {
    final json = jsonDecode(
      File('lib/src/catalog.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    final catalog = FoundationCatalog.fromJson(json);
    final messages = json['messages'] as Map<String, dynamic>;
    final names = json['languages'] as Map<String, dynamic>;
    expect(names.keys, Language.values.map((language) => language.name));
    for (final language in Language.values) {
      expect(parseLanguage(language.name), language);
      expect(catalog.languageName(language), names[language.name]);
      final entries = messages[language.name] as Map<String, dynamic>;
      expect(
        entries.keys.toSet(),
        TextKey.values.map((key) => key.name).toSet(),
      );
      for (final key in TextKey.values) {
        expect(catalog.text(language, key), entries[key.name]);
      }
    }
    expect(parseLanguage('fr'), isNull);
    expect(() => FoundationCatalog.fromJson({}), throwsFormatException);
    (messages['th'] as Map<String, dynamic>).remove('foundation');
    expect(() => FoundationCatalog.fromJson(json), throwsFormatException);
  });
}
