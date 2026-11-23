import 'dart:convert';
import 'dart:io';

import 'package:helpy_contracts/helpy_contracts.dart';
import 'package:test/test.dart';

void main() {
  test(
    'Dart accepts all 55 command and 15 query fixtures with exact parity',
    () {
      final fixture = jsonDecode(
        File('fixtures/f3-api.json').readAsStringSync(),
      ) as Map<String, dynamic>;
      expect(fixture['commandFields'], commandFields);
      expect(fixture['queryFields'], queryFields);
      expect(fixture['methodRoutes'], methodRoutes);
      expect(
        commandFields.length + queryFields.length + methodRoutes.length,
        75,
      );
      for (final input in fixture['commands'] as List<dynamic>) {
        expect(ApiCommand.fromJson(input).toJson(), input);
      }
      for (final input in fixture['queries'] as List<dynamic>) {
        expect(ApiQuery.fromJson(input).toJson(), input);
      }
      expect(fixture['queryViewFields'], queryViewFields);
      for (final input in fixture['queryViews'] as List<dynamic>) {
        expect(ApiQueryValue.fromJson(input).toJson(), input);
      }
      expect(
        () => ApiCommand.fromJson({
          'type': 'complete',
          'jobId': 'j',
          'admin': true,
        }),
        throwsFormatException,
      );
      expect(() => DecimalMoney('01'), throwsFormatException);
      expect(
        DecimalMoney('9007199254740993123456789').integer,
        BigInt.parse('9007199254740993123456789'),
      );
      final job = PublicJobView.fromJson({
        'id': 'job',
        'state': 'reserved',
        'items': <Object?>[],
        'cep': '1000',
        'fap': '1000',
        'publicAddress': 'District, Street',
        'address': null,
        'chatId': 'chat',
        'completedAt': null,
        'acceptedAt': null,
      });
      expect(job.publicAddress, 'District, Street');
      expect(job.address, isNull);
    },
  );
}
