import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:helpy_contracts/helpy_contracts.dart';

import '../../../core/localization/language_cubit.dart';

class FoundationPage extends StatelessWidget {
  const FoundationPage({required this.catalog, super.key});

  final FoundationCatalog catalog;

  @override
  Widget build(BuildContext context) =>
      BlocBuilder<LanguageCubit, LanguageState>(
        builder: (context, state) => Scaffold(
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 720),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 32),
                      Text(
                        'Helpy / F1',
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 48),
                      Text(
                        catalog.text(state.language, TextKey.foundation),
                        style: Theme.of(context).textTheme.displaySmall,
                      ),
                      const SizedBox(height: 24),
                      Text(catalog.text(state.language, TextKey.description)),
                      const SizedBox(height: 48),
                      Text(catalog.text(state.language, TextKey.language)),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: Language.values
                            .map(
                              (language) => ChoiceChip(
                                key: ValueKey(language.name),
                                label: Text(catalog.languageName(language)),
                                selected: state.language == language,
                                onSelected: (_) => context
                                    .read<LanguageCubit>()
                                    .select(language),
                              ),
                            )
                            .toList(growable: false),
                      ),
                      if (state.failure != null) ...[
                        const SizedBox(height: 24),
                        Text(
                          catalog.text(
                            state.language,
                            TextKey.preferenceUnavailable,
                          ),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
}
