import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:helpy_contracts/helpy_contracts.dart';

import 'core/localization/language_cubit.dart';
import 'features/foundation/presentation/foundation_page.dart';

class HelpyApp extends StatelessWidget {
  const HelpyApp({
    required this.catalog,
    required this.languageCubit,
    super.key,
  });

  final FoundationCatalog catalog;
  final LanguageCubit languageCubit;

  @override
  Widget build(BuildContext context) => BlocProvider<LanguageCubit>(
    create: (_) => languageCubit,
    child: BlocBuilder<LanguageCubit, LanguageState>(
      builder: (context, state) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: catalog.text(state.language, TextKey.title),
        locale: Locale(state.language.name),
        supportedLocales: Language.values
            .map((language) => Locale(language.name))
            .toList(growable: false),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF203E37),
            surface: const Color(0xFFF1F0E9),
          ),
        ),
        home: FoundationPage(catalog: catalog),
      ),
    ),
  );
}
