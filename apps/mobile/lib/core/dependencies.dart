import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:get_it/get_it.dart';
import 'package:helpy_contracts/helpy_contracts.dart';

import 'localization/language_cubit.dart';
import 'localization/language_preference.dart';
import 'localization/shared_preferences_language.dart';

const catalogAsset = 'packages/helpy_contracts/src/catalog.json';

Future<({FoundationCatalog catalog, LanguageCubit languageCubit})>
configureDependencies() async {
  final container = GetIt.asNewInstance();
  final catalog = FoundationCatalog.fromJson(
    jsonDecode(await rootBundle.loadString(catalogAsset)),
  );
  container.registerSingleton<FoundationCatalog>(catalog);
  container.registerSingleton<LanguagePreference>(
    await SharedPreferencesLanguage.open(),
  );
  container.registerFactory<LanguageCubit>(
    () => LanguageCubit(container<LanguagePreference>()),
  );
  return (
    catalog: container<FoundationCatalog>(),
    languageCubit: container<LanguageCubit>(),
  );
}
