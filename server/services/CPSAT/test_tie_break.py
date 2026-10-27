import unittest

from team_generator import generate_teams, suggest_upperclass_placements


def student(s_id, choices, prior=0, prior_3200=0):
    return {
        'id': s_id, 'major': 'CS', 'class': '3200', 'choices': choices, 'gender': 'Male',
        'day': 'Wednesday', 'priorSemesters': prior, 'prior3200Semesters': prior_3200,
    }


class TieBreakTests(unittest.TestCase):
    """Two 3200s want project A, which only has room for one of them."""

    def setUp(self):
        self.projects = [{'name': name, 'type': 'SW', 'day': 'Wednesday'} for name in ('A', 'B')]
        self.config = {'min_team_size': 1, 'max_team_size': 1, 'min_upperclass_per_project': 0,
                       'balance_gender': False}

    def winner_of_a(self, students):
        result = generate_teams(students, self.projects, self.config)
        self.assertTrue(result['success'])
        return result['teams']['A'][0]

    def test_second_time_3200_beats_first_time(self):
        # The first-timer has more semesters overall, but 3200 experience comes first.
        students = [student('new', ['A', 'B'], prior=4), student('back', ['A', 'B'], prior=1, prior_3200=1)]
        self.assertEqual(self.winner_of_a(students), 'back')
        self.assertEqual(self.winner_of_a(students[::-1]), 'back')

    def test_more_semesters_breaks_the_rest(self):
        students = [student('few', ['A', 'B'], prior=1), student('many', ['A', 'B'], prior=3)]
        self.assertEqual(self.winner_of_a(students), 'many')
        self.assertEqual(self.winner_of_a(students[::-1]), 'many')

    def test_never_costs_a_better_choice(self):
        # The veteran ranks B second, so giving them A would push the newcomer to an
        # unranked spot. Real choice scores win; the tie-break only settles true ties.
        students = [student('vet', ['A', 'B'], prior=5, prior_3200=2), student('new', ['A'])]
        self.assertEqual(self.winner_of_a(students), 'new')

    def test_suggest_3200_uses_the_same_order(self):
        students = [student('new', ['A', 'B'], prior=4), student('back', ['A', 'B'], prior=1, prior_3200=1)]
        result = suggest_upperclass_placements(students, self.projects, {'max_team_size': 1})
        self.assertTrue(result['success'])
        placed = {p['studentId']: p['projectName'] for p in result['placements']}
        self.assertEqual(placed, {'back': 'A', 'new': 'B'})


if __name__ == '__main__':
    unittest.main()
