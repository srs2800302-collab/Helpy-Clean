enum Language { th, ru, en }

Language? parseLanguage(Object? value) {
  for (final language in Language.values) {
    if (language.name == value) return language;
  }
  return null;
}

enum TextKey {
  title,
  adminTitle,
  foundation,
  description,
  language,
  preferenceUnavailable,
}

final class FoundationCatalog {
  FoundationCatalog.fromJson(Object? value) {
    if (value case {
      'languages': final Map<String, dynamic> names,
      'messages': final Map<String, dynamic> messages,
    }) {
      for (final language in Language.values) {
        final name = names[language.name];
        final entries = messages[language.name];
        if (name is! String ||
            name.trim().isEmpty ||
            entries is! Map<String, dynamic>) {
          throw const FormatException('Incomplete language catalog');
        }
        _names[language] = name;
        for (final key in TextKey.values) {
          final text = entries[key.name];
          if (text is! String || text.trim().isEmpty) {
            throw const FormatException('Missing localized text');
          }
          _messages[(language, key)] = text;
        }
      }
    } else {
      throw const FormatException('Invalid language catalog');
    }
  }

  final _names = <Language, String>{};
  final _messages = <(Language, TextKey), String>{};

  String languageName(Language language) => _names[language]!;
  String text(Language language, TextKey key) => _messages[(language, key)]!;
}

final class HealthResponse {
  const HealthResponse();

  factory HealthResponse.fromJson(Object? value) {
    if (value is Map<String, dynamic> &&
        value.length == 2 &&
        value['status'] == 'ok' &&
        value['contractVersion'] is num &&
        value['contractVersion'] == 1) {
      return const HealthResponse();
    }
    throw const FormatException('Invalid health response');
  }

  Map<String, Object> toJson() => {'status': 'ok', 'contractVersion': 1};
}
