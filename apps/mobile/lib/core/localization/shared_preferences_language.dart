import 'package:fpdart/fpdart.dart';
import 'package:helpy_contracts/helpy_contracts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'language_preference.dart';

final class SharedPreferencesLanguage implements LanguagePreference {
  SharedPreferencesLanguage(this._preferences);

  final SharedPreferences? _preferences;
  static const key = 'helpy.mobile.language';

  static Future<SharedPreferencesLanguage> open() async {
    try {
      return SharedPreferencesLanguage(await SharedPreferences.getInstance());
    } on Exception {
      return SharedPreferencesLanguage(null);
    }
  }

  @override
  Either<PreferenceFailure, Language?> read() {
    final preferences = _preferences;
    if (preferences == null) return left(PreferenceFailure.unavailable);
    final saved = preferences.get(key);
    if (saved == null) return right(null);
    final language = parseLanguage(saved);
    return language == null
        ? left(PreferenceFailure.invalidValue)
        : right(language);
  }

  @override
  Future<Either<PreferenceFailure, Unit>> write(Language language) async {
    final preferences = _preferences;
    if (preferences == null) return left(PreferenceFailure.unavailable);
    try {
      return await preferences.setString(key, language.name)
          ? right(unit)
          : left(PreferenceFailure.unavailable);
    } on Exception {
      return left(PreferenceFailure.unavailable);
    }
  }
}
