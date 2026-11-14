import 'package:fpdart/fpdart.dart';
import 'package:helpy_contracts/helpy_contracts.dart';

enum PreferenceFailure { unavailable, invalidValue }

abstract interface class LanguagePreference {
  Either<PreferenceFailure, Language?> read();
  Future<Either<PreferenceFailure, Unit>> write(Language language);
}
