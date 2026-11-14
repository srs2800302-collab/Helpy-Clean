import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helpy_contracts/helpy_contracts.dart';
import 'package:helpy_mobile/app.dart';
import 'package:helpy_mobile/core/dependencies.dart';
import 'package:helpy_mobile/core/localization/language_cubit.dart';
import 'package:helpy_mobile/core/localization/language_preference.dart';
import 'package:helpy_mobile/core/localization/shared_preferences_language.dart';
import 'package:helpy_mobile/main.dart' as entrypoint;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Mobile executable boots without Backend or Admin', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await tester.runAsync(entrypoint.main);
    await tester.pumpAndSettle();
    expect(find.byType(HelpyApp), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final source in Language.values) {
    for (final target in Language.values.where(
      (language) => language != source,
    )) {
      testWidgets(
        'Mobile switches ${source.name} -> ${target.name} without restart',
        (tester) async {
          SharedPreferences.setMockInitialValues({
            SharedPreferencesLanguage.key: source.name,
          });
          final dependencies = (await tester.runAsync(configureDependencies))!;
          await tester.pumpWidget(
            HelpyApp(
              catalog: dependencies.catalog,
              languageCubit: dependencies.languageCubit,
            ),
          );
          await tester.pumpAndSettle();
          expect(
            find.text(dependencies.catalog.text(source, TextKey.foundation)),
            findsOneWidget,
          );
          final chip = find.byKey(ValueKey(target.name));
          await tester.ensureVisible(chip);
          await tester.tap(chip);
          await tester.pumpAndSettle();
          expect(
            find.text(dependencies.catalog.text(target, TextKey.foundation)),
            findsOneWidget,
          );
          expect(
            Localizations.localeOf(tester.element(find.byType(Scaffold))),
            Locale(target.name),
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  test(
    'rapid changes render immediately and persist in selection order',
    () async {
      SharedPreferences.setMockInitialValues({});
      final cubit = LanguageCubit(await SharedPreferencesLanguage.open());
      final first = cubit.select(Language.th);
      final second = cubit.select(Language.ru);
      expect(cubit.state.language, Language.ru);
      await Future.wait([first, second]);
      await (await SharedPreferences.getInstance()).reload();
      final preferences = await SharedPreferencesLanguage.open();
      expect(preferences.read().getOrElse((_) => null), Language.ru);
      await cubit.close();
    },
  );

  test(
    'invalid stored value and unavailable storage produce typed failures',
    () async {
      SharedPreferences.setMockInitialValues({
        SharedPreferencesLanguage.key: 42,
      });
      final invalid = LanguageCubit(await SharedPreferencesLanguage.open());
      expect(invalid.state.language, Language.en);
      expect(invalid.state.failure, PreferenceFailure.invalidValue);
      await invalid.close();
      final unavailable = LanguageCubit(SharedPreferencesLanguage(null));
      await unavailable.select(Language.th);
      expect(unavailable.state.language, Language.th);
      expect(unavailable.state.failure, PreferenceFailure.unavailable);
      await unavailable.close();
    },
  );

  testWidgets(
    'small viewport supports every language and localized storage errors',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final catalog = FoundationCatalog.fromJson(
        jsonDecode(
          (await tester.runAsync(() => rootBundle.loadString(catalogAsset)))!,
        ),
      );
      final cubit = LanguageCubit(SharedPreferencesLanguage(null));
      await tester.pumpWidget(HelpyApp(catalog: catalog, languageCubit: cubit));
      for (final language in Language.values) {
        await cubit.select(language);
        await tester.pumpAndSettle();
        expect(
          find.text(catalog.text(language, TextKey.preferenceUnavailable)),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      }
    },
  );
}
