import unittest

from team_generator import generate_teams


class LockingTests(unittest.TestCase):
    def setUp(self):
        self.projects = [{'name': name, 'type': 'SW', 'day': 'Wednesday'} for name in ('A', 'B')]
        self.students = [
            {'id': str(i), 'major': 'CS', 'class': '3200' if i < 2 else '2200',
             'choices': ['A', 'B'], 'gender': 'Male', 'day': 'Wednesday'}
            for i in range(8)
        ]
        self.config = {'min_team_size': 4, 'max_team_size': 6,
                       'min_3200_per_team': 1, 'balance_gender': False}

    def solve(self, **locks):
        return generate_teams(self.students, self.projects, {**self.config, **locks})

    def assert_valid(self, result):
        self.assertTrue(result['success'], result)
        self.assertCountEqual([s for roster in result['teams'].values() for s in roster],
                              [s['id'] for s in self.students])
        for roster in result['teams'].values():
            self.assertGreaterEqual(len(roster), 4)
            self.assertLessEqual(len(roster), 6)
            self.assertGreaterEqual(sum(s in ('0', '1') for s in roster), 1)

    def test_student_lock_overrides_preference(self):
        result = self.solve(locked_student_assignments={'0': 'B'})
        self.assert_valid(result)
        self.assertIn('0', result['teams']['B'])

    def test_team_lock_preserves_exact_roster(self):
        roster = ['0', '2', '3', '4']
        result = self.solve(locked_teams={'A': roster})
        self.assert_valid(result)
        self.assertCountEqual(result['teams']['A'], roster)
        self.assertCountEqual(result['teams']['B'], ['1', '5', '6', '7'])

    def test_rerun_preserves_locks_after_preferences_change(self):
        first = self.solve(locked_student_assignments={'0': 'B'})
        self.assert_valid(first)
        for student in self.students:
            student['choices'] = ['B', 'A']
        result = self.solve(locked_teams={'B': first['teams']['B']})
        self.assert_valid(result)
        self.assertCountEqual(result['teams']['B'], first['teams']['B'])

    def test_compatible_student_and_team_locks(self):
        result = self.solve(locked_teams={'A': ['0', '2', '3', '4']},
                            locked_student_assignments={'0': 'A', '1': 'B'})
        self.assert_valid(result)

    def test_invalid_and_conflicting_locks(self):
        cases = [
            {'locked_student_assignments': {'missing': 'A'}},
            {'locked_student_assignments': {'0': 'missing'}},
            {'locked_teams': {'missing': []}},
            {'locked_teams': {'A': ['0', '0']}},
            {'locked_teams': {'A': '0'}},
            {'locked_student_assignments': None},
            {'locked_teams': {'A': ['0'], 'B': ['0']}},
            {'locked_teams': {'A': ['0', '2', '3', '4']},
             'locked_student_assignments': {'0': 'B'}},
            {'locked_teams': {'A': ['0', '2', '3', '4']},
             'locked_student_assignments': {'1': 'A'}},
        ]
        for locks in cases:
            with self.subTest(locks=locks), self.assertRaises(ValueError):
                self.solve(**locks)

    def test_locked_team_still_requires_3200_student(self):
        result = self.solve(locked_teams={'A': ['2', '3', '4', '5']})
        self.assertFalse(result['success'])
        self.assertIn('locks', result['error'])

    def test_locked_team_still_requires_valid_size(self):
        for roster in ([], ['0', '2', '3'], ['0', '2', '3', '4', '5', '6', '7']):
            with self.subTest(roster=roster):
                self.assertFalse(self.solve(locked_teams={'A': roster})['success'])

    def test_locked_student_still_requires_matching_day(self):
        self.students[0]['day'] = 'Thursday'
        self.assertFalse(self.solve(locked_student_assignments={'0': 'A'})['success'])

    def test_empty_locks_allow_normal_generation(self):
        self.assert_valid(self.solve(locked_student_assignments={}, locked_teams={}))


if __name__ == '__main__':
    unittest.main()
