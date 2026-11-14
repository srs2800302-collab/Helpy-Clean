import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:helpy_contracts/helpy_contracts.dart';

import 'language_preference.dart';

final class LanguageState {
  const LanguageState(this.language, {this.failure});
  final Language language;
  final PreferenceFailure? failure;
}

final class LanguageCubit extends Cubit<LanguageState> {
  LanguageCubit(this._preference)
    : super(
        _preference.read().fold(
          (failure) => LanguageState(Language.en, failure: failure),
          (language) => LanguageState(language ?? Language.en),
        ),
      );

  final LanguagePreference _preference;
  Future<void> _writes = Future<void>.value();

  Future<void> select(Language language) {
    emit(LanguageState(language));
    // Serialize persistence so rapid selections cannot restore an older value.
    _writes = _writes.then((_) async {
      final result = await _preference.write(language);
      if (!isClosed && state.language == language) {
        emit(
          result.fold(
            (failure) => LanguageState(language, failure: failure),
            (_) => LanguageState(language),
          ),
        );
      }
    });
    return _writes;
  }
}
